interface PreviewContext {
  chatId: string | null;
  projectId: string | null;
  focusRevision: number;
}
interface ReadyEvent {
  type: 'results-ready';
  autoPreviewEligible: boolean;
  results: {
    chatId: string;
    turnId: string;
    phase: string;
    requestStatus: string;
    selection: { groupIds: string[]; historical: boolean } | null;
    groups: Array<{
      id: string;
      primaryArtifactId: string;
      previewArtifactId?: string;
      superseded: boolean;
      historical: boolean;
      executionStatus: string;
    }>;
  };
}
export function createResultPreviewPolicy(): {
  begin(context: PreviewContext): void;
  invalidate(): void;
  consume(
    event: ReadyEvent,
    context: PreviewContext & { turnId: string | null },
  ): { turnId: string; groupId: string; artifactId: string } | null;
};
