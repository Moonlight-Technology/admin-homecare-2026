export type EmailContent = { subject: string; text: string; html: string };
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const subjects: Record<string, string> = {
  ACCOUNT_INVITATION: 'Aktivasi akun Nakes', PASSWORD_RESET_REQUESTED: 'Reset password Nakes',
  FACILITY_APPLICATION_SUBMITTED: 'Pengajuan verifikasi klinik menunggu tinjauan', FACILITY_VERIFICATION_DECIDED: 'Pembaruan verifikasi klinik',
  PRACTITIONER_SUBMITTED: 'Pengajuan verifikasi nakes menunggu tinjauan', PRACTITIONER_VERIFICATION_DECIDED: 'Pembaruan verifikasi nakes',
  AFFILIATION_PROPOSED: 'Pengajuan afiliasi menunggu tinjauan', AFFILIATION_DECIDED: 'Pembaruan afiliasi nakes', ORDER_SUBMITTED: 'Order baru menunggu persetujuan',
};

export function renderEmail(type: string, payload: Record<string, unknown>, webOrigin: string): EmailContent {
  const subject = subjects[type];
  if (!subject) throw new Error('TEMPLATE_NOT_SUPPORTED');
  let link = new URL('/login', webOrigin).toString();
  let detail = 'Ada pembaruan di aplikasi Nakes. Silakan masuk untuk melihat detail sesuai hak akses Anda.';
  let label = 'Buka Nakes';
  if (type === 'ACCOUNT_INVITATION' || type === 'PASSWORD_RESET_REQUESTED') {
    const invitation = type === 'ACCOUNT_INVITATION';
    link = String(payload[invitation ? 'invitationUrl' : 'resetUrl']);
    label = invitation ? 'Aktivasi akun' : 'Reset password';
    detail = invitation ? 'Anda diundang menggunakan Nakes. Gunakan tautan sekali pakai berikut untuk mengatur password. Tautan berlaku sesuai masa undangan.' : 'Gunakan tautan sekali pakai berikut untuk mengganti password. Jika Anda tidak meminta reset, abaikan email ini.';
  } else if (type === 'ORDER_SUBMITTED') {
    const date = new Date(String(payload.scheduledAt));
    let scheduled = '';
    if (Number.isFinite(date.getTime())) {
      const timezone = String(payload.timezone ?? 'Asia/Jakarta');
      scheduled = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeStyle: 'short', timeZone: timezone }).format(date) + ` (${timezone})`;
    }
    detail = `Order ${String(payload.code ?? '')} menunggu persetujuan klinik.${scheduled ? ` Jadwal: ${scheduled}.` : ''} Masuk untuk memeriksa status terbaru.`;
  }
  // Never include review reason, credentials, patient snapshots, or arbitrary payload fields.
  return { subject, text: `${subject}\n\n${detail}\n\n${label}: ${link}\n\nJangan bagikan tautan akun kepada orang lain.`, html: `<!doctype html><html lang="id"><body><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(detail)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p><p>Jangan bagikan tautan akun kepada orang lain.</p></body></html>` };
}
