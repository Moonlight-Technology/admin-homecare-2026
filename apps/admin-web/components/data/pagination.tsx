import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';

/** Server-driven pagination footer. */
export function Pagination({ page, limit, total, onPageChange }: { page: number; limit: number; total: number; onPageChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
      <span>{total === 0 ? 'Tidak ada data' : `${formatNumber(first)}–${formatNumber(last)} dari ${formatNumber(total)}`}</span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="icon" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft /></Button>
        <span className="min-w-16 text-center" aria-live="polite">{page} / {totalPages}</span>
        <Button variant="secondary" size="icon" aria-label="Halaman berikutnya" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}
