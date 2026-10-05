import { memo, useEffect } from 'react';
import { useDisplayText } from '../text';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function EmbeddedImage({ alt }: { alt?: string }) {
  const { t } = useDisplayText();
  return (
    <span className="rp-markdown-image">
      [{t('Image')}: {alt || t('embedded image')}]
    </span>
  );
}

// No project HTML, active links, embedded media, or network/file loads.
const components: Components = {
  a: ({ children }) => <span className="rp-markdown-link">{children}</span>,
  img: EmbeddedImage,
};
type Ast = { children?: Ast[] };
function boundedMarkdown() {
  return (tree: Ast) => {
    const stack = [{ node: tree, depth: 0 }];
    let count = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (++count > 20000 || current.depth > 64)
        throw Error('Markdown exceeds the node/depth limit');
      for (const child of current.node.children ?? [])
        stack.push({ node: child, depth: current.depth + 1 });
    }
  };
}
const plugins = [remarkGfm, boundedMarkdown];
function MarkdownView({ text, onReady }: { text: string; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <article className="rp-document-markdown">
      <Markdown skipHtml remarkPlugins={plugins} components={components} urlTransform={() => ''}>
        {text.replace(/^\uFEFF/, '')}
      </Markdown>
    </article>
  );
}
export default memo(MarkdownView);
