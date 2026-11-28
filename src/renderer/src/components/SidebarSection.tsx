import { type ReactNode, useId, useState } from 'react';

/**
 * Seção expansível do menu lateral da mesa. Mantém a semântica de região
 * (`<section aria-label>`) e lembra a preferência aberta/fechada por seção.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = 'vtt:sidebar:';

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSectionOpen(id: string, fallback: boolean, storage: KeyValueStorage | null = browserStorage()): boolean {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${id}`);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // Storage indisponível: mantém o padrão.
  }
  return fallback;
}

export function writeSectionOpen(id: string, open: boolean, storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${id}`, open ? '1' : '0');
  } catch {
    // Ignora falhas de gravação em ambientes restritos.
  }
}

export interface SidebarSectionProps {
  /** Identificador estável para persistir o estado aberto/fechado. */
  id: string;
  /** Título exibido no cabeçalho clicável da seção. */
  title: string;
  /** Nome acessível da região (`aria-label`). Padrão: `title`. */
  ariaLabel?: string;
  /** Indicador opcional exibido ao lado do título (contagem, status, rodada…). */
  badge?: ReactNode;
  /** Estado inicial quando não há preferência salva. */
  defaultOpen?: boolean;
  /** Expande automaticamente quando esta condição muda de `false` para `true`. */
  autoExpandWhen?: boolean;
  /** Classes extras aplicadas na `<section>`. */
  className?: string;
  children: ReactNode;
}

export function SidebarSection({
  id,
  title,
  ariaLabel,
  badge,
  defaultOpen = true,
  autoExpandWhen = false,
  className,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState<boolean>(() => readSectionOpen(id, defaultOpen));
  const [prevAutoExpand, setPrevAutoExpand] = useState(autoExpandWhen);
  const bodyId = useId();

  if (autoExpandWhen !== prevAutoExpand) {
    setPrevAutoExpand(autoExpandWhen);
    if (autoExpandWhen && !open) setOpen(true);
  }

  const toggle = (): void => {
    setOpen((current) => {
      const next = !current;
      writeSectionOpen(id, next);
      return next;
    });
  };

  const sectionClass = ['sidebar-section', open ? 'open' : 'collapsed', className].filter(Boolean).join(' ');

  return (
    <section className={sectionClass} aria-label={ariaLabel ?? title}>
      <h2 className="sidebar-section-heading">
        <button
          type="button"
          className="sidebar-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="sidebar-section-title">{title}</span>
          {badge !== undefined && <span className="sidebar-section-badge">{badge}</span>}
          <span className="sidebar-section-chevron" aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="sidebar-section-body">
          {children}
        </div>
      )}
    </section>
  );
}
