import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileCheck2,
  LayoutDashboard,
  ScrollText,
  Stethoscope,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Menus from spec §4. `permission` only hides links; the API is the real gate. `ready` marks pages already built,
 * so each slice flips its flag when its page lands.
 */
export type NavItem = { label: string; href: string; icon: LucideIcon; permission?: string; ready: boolean };

export const PLATFORM_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, permission: 'platform:dashboard:read', ready: true },
  { label: 'Verifikasi Klinik', href: '/admin/facility-applications', icon: ClipboardCheck, permission: 'facility:review', ready: true },
  { label: 'Klinik', href: '/admin/facilities', icon: Building2, permission: 'facility:read', ready: false },
  { label: 'Tenaga Kesehatan', href: '/admin/practitioners', icon: Stethoscope, permission: 'practitioner:read', ready: true },
  { label: 'Master Data', href: '/admin/master', icon: Database, permission: 'master:read', ready: true },
  { label: 'Order', href: '/admin/orders', icon: ClipboardList, permission: 'order:read-all', ready: true },
  { label: 'Pengguna', href: '/admin/users', icon: UserCog, permission: 'platform-user:read', ready: false },
  { label: 'Audit Log', href: '/admin/audit-logs', icon: ScrollText, permission: 'audit:read', ready: true },
];

export const CLINIC_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/clinic', icon: LayoutDashboard, permission: 'clinic:dashboard:read', ready: true },
  { label: 'Order', href: '/clinic/orders', icon: ClipboardList, permission: 'order:read', ready: true },
  { label: 'Layanan', href: '/clinic/services', icon: Store, permission: 'offering:read', ready: true },
  { label: 'Jadwal', href: '/clinic/schedules', icon: CalendarClock, permission: 'schedule:read', ready: true },
  { label: 'Tenaga Kesehatan', href: '/clinic/practitioners', icon: Stethoscope, permission: 'affiliation:read', ready: true },
  { label: 'Staf', href: '/clinic/staff', icon: Users, permission: 'staff:read', ready: false },
  { label: 'Profil Klinik', href: '/clinic/profile', icon: Building2, permission: 'clinic:profile:read', ready: true },
  { label: 'Verifikasi', href: '/clinic/verification', icon: FileCheck2, permission: 'clinic:verification:submit', ready: true },
];
