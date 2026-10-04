// Harness bridge over OCCT AIS/V3d/TKOpenGles. Initialization follows OCCT's
// MIT-licensed samples/webgl (Open CASCADE SAS, 2019); see upstream notices.
#include <AIS_InteractiveContext.hxx>
#include <AIS_Shape.hxx>
#include <AIS_Triangulation.hxx>
#include <BRep_Builder.hxx>
#include <BRepTools.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <OpenGl_GraphicDriver.hxx>
#include <Wasm_Window.hxx>
#include <V3d_Viewer.hxx>
#include <V3d_View.hxx>
#include <Prs3d_Drawer.hxx>
#include <Prs3d_LineAspect.hxx>
#include <Graphic3d_Camera.hxx>
#include <TopExp_Explorer.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <vector>
#include <Standard_Failure.hxx>
#include <emscripten/bind.h>
#include <sstream>
#include <cmath>
#include <stdexcept>

class Viewer {
  Handle(OpenGl_GraphicDriver) driver;
  Handle(V3d_Viewer) viewer;
  Handle(V3d_View) view;
  Handle(AIS_InteractiveContext) context;
  Handle(Graphic3d_Camera) fitted;
  double fitScale = 1;
  int faces = 0;
public:
  Viewer(const std::string& selector) {
    Handle(Aspect_DisplayConnection) display;
    driver = new OpenGl_GraphicDriver(display, false);
    driver->ChangeOptions().buffersNoSwap = true;
    driver->ChangeOptions().buffersOpaqueAlpha = true;
    if (!driver->InitContext()) throw std::runtime_error("OCCT WebGL2 initialization failed");
    viewer = new V3d_Viewer(driver);
    viewer->SetDefaultShadingModel(Graphic3d_TypeOfShadingModel_Phong);
    viewer->SetDefaultLights();
    viewer->SetLightOn();
    view = new V3d_View(viewer);
    view->SetImmediateUpdate(false);
    view->Camera()->SetProjectionType(Graphic3d_Camera::Projection_Orthographic);
    view->ChangeRenderingParams().NbMsaaSamples = 4;
    view->SetBgGradientColors(Quantity_Color(0.12,0.16,0.22,Quantity_TOC_RGB),
      Quantity_Color(0.035,0.05,0.08,Quantity_TOC_RGB),Aspect_GFM_VER,false);
    view->SetWindow(new Wasm_Window(selector.c_str()));
    context = new AIS_InteractiveContext(viewer);
  }
  int load(const std::string& filename) {
    context->RemoveAll(false);
    Handle(AIS_InteractiveObject) object;
    {
      TopoDS_Shape shape;
      BRep_Builder builder;
      if(!BRepTools::Read(shape,filename.c_str(),builder) || shape.IsNull())
        throw std::runtime_error("OCCT could not read the BREP companion");
      faces = 0;
      for(TopExp_Explorer it(shape,TopAbs_FACE);it.More();it.Next())
        if(++faces > 5000) throw std::runtime_error("OCCT face limit exceeded");
      if(!faces) throw std::runtime_error("OCCT model has no faces");
      BRepMesh_IncrementalMesh mesher(shape,0.12,false,0.25,false);
      Handle(AIS_Shape) solid = new AIS_Shape(shape);
      solid->Attributes()->SetFaceBoundaryDraw(true);
      solid->Attributes()->SetFaceBoundaryAspect(new Prs3d_LineAspect(
        Quantity_Color(0.09,0.17,0.23,Quantity_TOC_RGB),Aspect_TOL_SOLID,1));
      object = solid;
    }
    object->SetColor(Quantity_Color(0.35,0.65,0.84,Quantity_TOC_RGB));
    context->Display(object,AIS_Shaded,0,false);
    fit();
    return faces;
  }
  int loadMesh(const emscripten::val& values) {
    auto points = emscripten::convertJSArrayToNumberVector<double>(values);
    if(points.empty() || points.size()%9 || points.size()>900000)
      throw std::runtime_error("Invalid OCCT mesh size");
    Handle(Poly_Triangulation) triangles = new Poly_Triangulation(points.size()/3,points.size()/9,false);
    for(size_t i=0;i<points.size();i+=3) {
      if(!std::isfinite(points[i]) || !std::isfinite(points[i+1]) || !std::isfinite(points[i+2]))
        throw std::runtime_error("Nonfinite OCCT mesh vertex");
      triangles->SetNode(i/3+1,gp_Pnt(points[i],points[i+1],points[i+2]));
    }
    for(int i=1;i<=triangles->NbTriangles();++i)
      triangles->SetTriangle(i,Poly_Triangle(i*3-2,i*3-1,i*3));
    triangles->ComputeNormals();
    Handle(AIS_Triangulation) object = new AIS_Triangulation(triangles);
    object->SetColor(Quantity_Color(0.35,0.65,0.84,Quantity_TOC_RGB));
    context->RemoveAll(false);
    context->Display(object,AIS_Shaded,0,false);
    faces=triangles->NbTriangles(); fit(); return faces;
  }
  void fit() {
    view->SetProj(1,-1,1);
    view->SetUp(0,0,1);
    view->FitAll(0.1,false);
    view->ZFitAll();
    fitted = new Graphic3d_Camera(view->Camera());
    fitScale = view->Camera()->Scale();
    view->Redraw();
  }
  void pose(double yaw,double pitch,double zoom,int x,int y) {
    if(!std::isfinite(yaw)||!std::isfinite(pitch)||!std::isfinite(zoom)||zoom<0.1||zoom>20)
      throw std::runtime_error("Invalid CAD camera pose");
    view->Camera()->Copy(fitted);
    view->SetProj(std::cos(pitch)*std::cos(yaw),std::cos(pitch)*std::sin(yaw),std::sin(pitch));
    view->SetUp(0,0,1);
    view->Camera()->SetScale(fitScale/zoom);
    view->Pan(x,-y,1,true);
    view->ZFitAll();
    view->Redraw();
  }
  void resize() { view->MustBeResized(); view->Redraw(); }
  void dispose() {
    context->RemoveAll(false);
    view->Remove();
    context.Nullify(); view.Nullify(); viewer.Nullify(); driver.Nullify();
  }
};
EMSCRIPTEN_BINDINGS(HarnessOCCT) {
  emscripten::class_<Viewer>("Viewer").constructor<std::string>()
    .function("load",&Viewer::load).function("loadMesh",&Viewer::loadMesh).function("fit",&Viewer::fit)
    .function("pose",&Viewer::pose).function("resize",&Viewer::resize)
    .function("dispose",&Viewer::dispose);
}
