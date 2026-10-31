import { useT } from '../i18n/index.tsx';
import { Modal } from './Modal.tsx';

export function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const items = ['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5', 'rules.6', 'rules.7', 'rules.8'] as const;
  return (
    <Modal open={open} onClose={onClose} title={t('rules.title')} wide>
      <p className="muted">{t('rules.intro')}</p>
      <ol className="rules-list">
        {items.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
    </Modal>
  );
}
