'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Order rows on dashboards carry no patient identity (least privilege, spec §3). */
export type DashboardOrder = { id: string; code: string; status: string; mode: string; scheduledAt: string; createdAt: string; itemCount: number; facilityName?: string | null };

export type PlatformSummary = {
  kpis: { pendingFacilityReviews: number; pendingPractitionerReviews: number; activeFacilities: number; pendingOrderApprovals: number; openOrders: number };
  facilityQueue: Array<{ id: string; displayName: string; verificationStatus: string; updatedAt: string }>;
  practitionerQueue: Array<{ id: string; fullName: string; verificationStatus: string; updatedAt: string; practitionerType: { name: string } }>;
  recentOrders: DashboardOrder[];
};

export type ClinicSummary = {
  facility: { id: string; displayName: string; verificationStatus: string; operatingStatus: string };
  kpis: { pendingApproval: number; todayConfirmed: number; todayInProgress: number; activeOfferings: number; unassignedVisits: number };
  pendingQueue: DashboardOrder[];
};

export const usePlatformSummary = () => useQuery({ queryKey: ['dashboard', 'platform'], queryFn: () => api<PlatformSummary>('/admin/dashboard/summary') });
export const useClinicSummary = () => useQuery({ queryKey: ['dashboard', 'clinic'], queryFn: () => api<ClinicSummary>('/clinic/dashboard/summary') });
