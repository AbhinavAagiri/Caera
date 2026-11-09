import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        className="mr-1.5 h-3 w-3 align-middle accent-[var(--c-accent)]"
      />
    ) : null,
};

export function MarkdownMessage({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
