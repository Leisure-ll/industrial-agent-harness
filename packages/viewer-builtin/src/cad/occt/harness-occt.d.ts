export interface OcctViewer {
  load(filename: string): number;
  loadMesh(vertices: number[]): number;
  fit(): void;
  pose(yaw: number, pitch: number, zoom: number, x: number, y: number): void;
  resize(): void;
  dispose(): void;
  delete(): void;
}
export interface OcctModule {
  Viewer: new (selector: string) => OcctViewer;
  FS: { writeFile(name: string, bytes: Uint8Array): void; unlink(name: string): void };
}
export default function createOcctViewer(options: {
  canvas: HTMLCanvasElement;
  locateFile: (name: string) => string;
  printErr: (message: string) => void;
}): Promise<OcctModule>;
