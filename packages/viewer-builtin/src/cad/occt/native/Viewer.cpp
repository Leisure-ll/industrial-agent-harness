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
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <Graphic3d_ClipPlane.hxx>
#include <SelectMgr_EntityOwner.hxx>
#include <StdSelect_BRepOwner.hxx>
#include <iomanip>
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
  Handle(AIS_Shape) solid;
  Handle(Graphic3d_ClipPlane) clip;
  TopTools_IndexedMapOfShape faceMap, edgeMap;
  struct Pick { Handle(SelectMgr_EntityOwner) owner; TopoDS_Shape shape; };
  std::vector<Pick> picks;
  int selectionMode = 0;
  void reset() {
    picks.clear(); faceMap.Clear(); edgeMap.Clear(); solid.Nullify();
    context->RemoveAll(false);
    if (!clip.IsNull()) { view->RemoveClipPlane(clip); clip.Nullify(); }
  }
  static void point(std::ostream& out, const gp_Pnt& p) {
    out << '[' << p.X() << ',' << p.Y() << ',' << p.Z() << ']';
  }
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
    // React owns CSS layout and the bounded device-pixel backing size. OCCT's
    // automatic scaling would pin inline CSS dimensions and cover the inspector.
    view->SetWindow(new Wasm_Window(selector.c_str(),false));
    context = new AIS_InteractiveContext(viewer);
    context->SetPixelTolerance(6);
  }
  int load(const std::string& filename) {
    reset();
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
      solid = new AIS_Shape(shape);
      TopExp::MapShapes(shape,TopAbs_FACE,faceMap);
      TopExp::MapShapes(shape,TopAbs_EDGE,edgeMap);
      solid->Attributes()->SetFaceBoundaryDraw(true);
      solid->Attributes()->SetFaceBoundaryAspect(new Prs3d_LineAspect(
        Quantity_Color(0.09,0.17,0.23,Quantity_TOC_RGB),Aspect_TOL_SOLID,1));
      object = solid;
    }
    object->SetColor(Quantity_Color(0.35,0.65,0.84,Quantity_TOC_RGB));
    context->Display(object,AIS_Shaded,0,false);
    context->Deactivate(object);
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
    reset();
    context->Display(object,AIS_Shaded,0,false);
    faces=triangles->NbTriangles(); fit(); return faces;
  }
  void mode(int value) {
    if(value!=0 && value!=2 && value!=4) throw std::runtime_error("Invalid CAD selection mode");
    selectionMode=value;
    context->ClearDetected(false);
    context->Deactivate();
    if(value && !solid.IsNull()) context->Activate(solid,value);
    view->Redraw();
  }
  void hover(int x,int y) {
    if(!selectionMode || solid.IsNull()) return;
    context->MoveTo(x,y,view,false); view->Redraw();
  }
  std::string select(int x,int y) {
    if(!selectionMode || solid.IsNull()) return selection();
    context->MoveTo(x,y,view,false);
    const auto owner=Handle(StdSelect_BRepOwner)::DownCast(context->DetectedOwner());
    if(owner.IsNull() || !owner->HasShape()) return selection();
    const TopoDS_Shape shape=owner->Shape();
    for(auto it=picks.begin();it!=picks.end();++it) {
      if(it->shape.IsSame(shape)) {
        context->AddOrRemoveSelected(it->owner,false); picks.erase(it);
        view->Redraw(); return selection();
      }
    }
    if(picks.size()==2) {
      context->AddOrRemoveSelected(picks.front().owner,false); picks.erase(picks.begin());
    }
    picks.push_back({owner,shape}); context->AddOrRemoveSelected(owner,false);
    view->Redraw(); return selection();
  }
  void clearSelection() {
    picks.clear(); context->ClearSelected(false); context->ClearDetected(false); view->Redraw();
  }
  std::string selection() {
    std::ostringstream out; out << std::setprecision(17) << "{\"items\":[";
    for(size_t i=0;i<picks.size();++i) {
      if(i) out << ',';
      const auto& s=picks[i].shape;
      GProp_GProps props;
      if(s.ShapeType()==TopAbs_EDGE) {
        BRepGProp::LinearProperties(s,props);
        BRepAdaptor_Curve curve(TopoDS::Edge(s));
        out << "{\"kind\":\"edge\",\"index\":" << edgeMap.FindIndex(s)
          << ",\"length\":" << props.Mass();
        if(curve.GetType()==GeomAbs_Circle)
          out << ",\"radius\":" << curve.Circle().Radius();
      } else if(s.ShapeType()==TopAbs_FACE) {
        BRepGProp::SurfaceProperties(s,props);
        BRepAdaptor_Surface surface(TopoDS::Face(s));
        out << "{\"kind\":\"face\",\"index\":" << faceMap.FindIndex(s)
          << ",\"area\":" << props.Mass();
        if(surface.GetType()==GeomAbs_Cylinder)
          out << ",\"radius\":" << surface.Cylinder().Radius();
      } else throw std::runtime_error("Unsupported selected topology");
      out << ",\"center\":"; point(out,props.CentreOfMass()); out << '}';
    }
    out << ']';
    if(picks.size()==2) {
      BRepExtrema_DistShapeShape distance(picks[0].shape,picks[1].shape);
      if(!distance.IsDone() || !distance.NbSolution())
        throw std::runtime_error("OCCT distance computation failed");
      out << ",\"distance\":" << distance.Value() << ",\"points\":[";
      point(out,distance.PointOnShape1(1)); out << ','; point(out,distance.PointOnShape2(1));
      out << ']';
    }
    out << '}'; return out.str();
  }
  emscripten::val project(double x,double y,double z) {
    if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z))
      throw std::runtime_error("Invalid CAD dimension point");
    int px,py; view->Convert(x,y,z,px,py);
    auto result=emscripten::val::array(); result.set(0,px); result.set(1,py); return result;
  }
  void section(int axis,double offset,bool flip,bool enabled) {
    if(axis<0 || axis>2 || !std::isfinite(offset) || std::abs(offset)>1e7)
      throw std::runtime_error("Invalid CAD section plane");
    if(clip.IsNull()) {
      clip=new Graphic3d_ClipPlane(); clip->SetCapping(true);
      clip->SetCappingColor(Quantity_Color(0.95,0.65,0.24,Quantity_TOC_RGB));
      view->AddClipPlane(clip);
    }
    const double sign=flip?-1:1;
    clip->SetEquation(Graphic3d_Vec4d(axis==0?sign:0,axis==1?sign:0,axis==2?sign:0,-sign*offset));
    clip->SetOn(enabled); view->Redraw();
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
    // Fit captures orientation/scale, but resize owns the current window ratio.
    const double aspect = view->Camera()->Aspect();
    view->Camera()->Copy(fitted);
    view->Camera()->SetAspect(aspect);
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
    .function("mode",&Viewer::mode).function("hover",&Viewer::hover)
    .function("select",&Viewer::select).function("selection",&Viewer::selection)
    .function("clearSelection",&Viewer::clearSelection).function("project",&Viewer::project)
    .function("section",&Viewer::section)
    .function("dispose",&Viewer::dispose);
}
