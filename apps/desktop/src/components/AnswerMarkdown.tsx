import { Component, memo, useDeferredValue, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitLeadingThinking } from '../message-content';
import { useDisplayText } from '@industrial-agent-harness/viewer-builtin/text';
import { ThinkingPreview } from './ThinkingPreview';

const components: Components = {
  // Replies never load model-supplied images or navigate the workspace.
  a: ({ children }) => <span className="ia-markdown-link">{children}</span>,
  img: MarkdownImage,
  table: MarkdownTable,
};
function MarkdownImage({ alt }: { alt?: string }) {
  const { t } = useDisplayText();
  return (
    <span className="ia-markdown-image">
      [{t('Image: {0}', { 0: alt || t('Embedded image') })}]
    </span>
  );
}
function MarkdownTable({ children }: { children?: ReactNode }) {
  const { t } = useDisplayText();
  return (
    <div className="ia-markdown-table" tabIndex={0} role="region" aria-label={t('Table')}>
      <table>{children}</table>
    </div>
  );
}
type Ast = { children?: Ast[] };
function boundedMarkdown() {
  return (tree: Ast) => {
    const stack = [{ node: tree, depth: 0 }];
    let count = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (++count > 20000 || current.depth > 64) throw Error('Markdown display limit exceeded');
      for (const node of current.node.children ?? [])
        stack.push({ node, depth: current.depth + 1 });
    }
  };
}
const plugins = [remarkGfm, boundedMarkdown];

function SourceFallback({ text }: { text: string }) {
  const { t } = useDisplayText();
  return (
    <>
      <small>{t('Markdown display limit reached; original text follows.')}</small>
      <pre className="ia-answer-source">{text}</pre>
    </>
  );
}
class MarkdownBoundary extends Component<{ text: string; children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: Readonly<{ text: string; children: ReactNode }>) {
    if (this.state.failed && previous.text !== this.props.text) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <SourceFallback text={this.props.text} /> : this.props.children;
  }
}

export const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
  active = false,
}: {
  text: string;
  active?: boolean;
}) {
  const displayed = useDeferredValue(text);
  const { thoughts, body } = splitLeadingThinking(displayed);
  return (
    <div className="ia-message-content">
      {thoughts.map((thought, index) => (
        <ThinkingPreview key={index} text={thought.text} active={active && thought.incomplete} />
      ))}
      {body && (
        <div className="ia-markdown">
          {body.length > 256 * 1024 ? (
            <SourceFallback text={body} />
          ) : (
            <MarkdownBoundary text={body}>
              <Markdown
                skipHtml
                remarkPlugins={plugins}
                components={components}
                urlTransform={() => ''}
              >
                {body}
              </Markdown>
            </MarkdownBoundary>
          )}
        </div>
      )}
    </div>
  );
});
