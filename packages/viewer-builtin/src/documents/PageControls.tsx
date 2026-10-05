import { useDisplayText } from '../text';
export function PageControls({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useDisplayText();
  return (
    <nav className="rp-document-pages" aria-label={t('Document pages')}>
      <button disabled={page === 0} onClick={() => onPage(page - 1)}>
        {t('Previous')}
      </button>
      <span>
        {t('Page')} {page + 1} / {Math.max(1, pages)}
      </span>
      <button disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        {t('Next')}
      </button>
    </nav>
  );
}
