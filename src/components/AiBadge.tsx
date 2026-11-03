import { useI18n } from '../i18n/index.tsx';

/** Marks a virtual (AI) opponent everywhere it appears — they are never passed off as real people. */
export function AiBadge({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={`ai-badge ${className}`} title={t('virtual.badgeTitle')} aria-label={t('virtual.badgeTitle')}>
      AI
    </span>
  );
}
