# Nakes API — daftar endpoint

Dihasilkan oleh `pnpm contracts:generate`. Panduan penggunaan: [SWAGGER.md](SWAGGER.md).

Total: **144 operasi**. Path sudah menyertakan prefix API.

## Health

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/health` | public | — |

## Audit

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/audit-logs` | audit:read | — |

## Auth

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| POST | `/api/v1/auth/login` | public | LoginDto |
| POST | `/api/v1/auth/refresh` | Refresh cookie + Origin | — |
| POST | `/api/v1/auth/logout` | Refresh cookie + Origin | — |
| POST | `/api/v1/auth/forgot-password` | public | ForgotPasswordDto |
| POST | `/api/v1/auth/reset-password` | public | ResetPasswordDto |
| POST | `/api/v1/auth/accept-invitation` | public | AcceptInvitationDto |
| GET | `/api/v1/me` | authenticated | — |

## Admin: Users

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/users` | platform-user:read | — |
| POST | `/api/v1/admin/users` | platform-user:manage | InvitePlatformUserDto |
| GET | `/api/v1/admin/users/{id}` | platform-user:read | — |
| PATCH | `/api/v1/admin/users/{id}` | platform-user:manage | UpdatePlatformUserDto |
| POST | `/api/v1/admin/users/{id}/status` | platform-user:manage | PlatformUserStatusDto |
| POST | `/api/v1/admin/users/{id}/resend-invitation` | platform-user:manage | — |

## Clinic: Staff

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/staff` | staff:read | — |
| POST | `/api/v1/clinic/staff` | staff:manage | InviteStaffDto |
| GET | `/api/v1/clinic/staff/roles` | staff:read | — |
| GET | `/api/v1/clinic/staff/{id}` | staff:read | — |
| PATCH | `/api/v1/clinic/staff/{id}` | staff:manage | UpdateStaffRoleDto |
| POST | `/api/v1/clinic/staff/{id}/access` | staff:manage | StaffAccessDto |
| POST | `/api/v1/clinic/staff/{id}/resend-invitation` | staff:manage | — |

## Dashboard

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/dashboard/summary` | platform:dashboard:read | — |
| GET | `/api/v1/clinic/dashboard/summary` | clinic:dashboard:read | — |

## Master data: Facility types

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/facility-types` | master:read | — |
| POST | `/api/v1/admin/master/facility-types` | master:write | CreateTaxonomyDto |
| GET | `/api/v1/admin/master/facility-types/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/facility-types/{id}` | master:write | UpdateTaxonomyDto |

## Master data: Clinic classes

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/clinic-classes` | master:read | — |
| POST | `/api/v1/admin/master/clinic-classes` | master:write | CreateTaxonomyDto |
| GET | `/api/v1/admin/master/clinic-classes/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/clinic-classes/{id}` | master:write | UpdateTaxonomyDto |

## Master data: Facility capabilities

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/facility-capabilities` | master:read | — |
| POST | `/api/v1/admin/master/facility-capabilities` | master:write | CreateTaxonomyDto |
| GET | `/api/v1/admin/master/facility-capabilities/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/facility-capabilities/{id}` | master:write | UpdateTaxonomyDto |

## Master data: Practitioner types

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/practitioner-types` | master:read | — |
| POST | `/api/v1/admin/master/practitioner-types` | master:write | CreateTaxonomyDto |
| GET | `/api/v1/admin/master/practitioner-types/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/practitioner-types/{id}` | master:write | UpdateTaxonomyDto |

## Master data: Service categories

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/service-categories` | master:read | — |
| POST | `/api/v1/admin/master/service-categories` | master:write | CreateServiceCategoryDto |
| GET | `/api/v1/admin/master/service-categories/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/service-categories/{id}` | master:write | UpdateServiceCategoryDto |

## Master data: Master services

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/master-services` | master:read | — |
| POST | `/api/v1/admin/master/master-services` | master:write | CreateMasterServiceDto |
| GET | `/api/v1/admin/master/master-services/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/master-services/{id}` | master:write | UpdateMasterServiceDto |

## Master data: Document requirements

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/document-requirements` | master:read | — |
| POST | `/api/v1/admin/master/document-requirements` | master:write | CreateDocumentRequirementDto |
| GET | `/api/v1/admin/master/document-requirements/{id}` | master:read | — |
| PATCH | `/api/v1/admin/master/document-requirements/{id}` | master:write | UpdateDocumentRequirementDto |

## Master data: Regions

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/master/regions` | master:read | — |
| POST | `/api/v1/admin/master/regions/import` | master:write | ImportRegionsDto |

## Public: Master options

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/public/master-options` | public | — |

## Clinic registration

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| POST | `/api/v1/clinic-registration` | public | ClinicRegistrationDto |

## Admin: Facilities

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/facilities/{id}/media` | facility:read | — |
| GET | `/api/v1/admin/facilities` | facility:read | — |
| POST | `/api/v1/admin/facilities` | facility:create | AdminCreateFacilityDto |
| GET | `/api/v1/admin/facilities/{id}` | facility:read | — |
| PATCH | `/api/v1/admin/facilities/{id}` | facility:update | UpdateFacilityProfileDto |
| POST | `/api/v1/admin/facilities/{id}/status` | facility:status | FacilityStatusDto |
| POST | `/api/v1/admin/facilities/{id}/resend-invitation` | facility:create | — |

## Admin: Facility applications

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/facility-applications` | facility:review | — |
| GET | `/api/v1/admin/facility-applications/{id}` | facility:review | — |
| POST | `/api/v1/admin/facility-applications/{id}/start-review` | facility:review | — |
| POST | `/api/v1/admin/facility-applications/{id}/reviews` | facility:review | ReviewDecisionDto |

## Clinic: Profile & verification

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/profile` | clinic:profile:read | — |
| PATCH | `/api/v1/clinic/profile` | clinic:profile:update | UpdateFacilityProfileDto |
| GET | `/api/v1/clinic/verification` | clinic:profile:read | — |
| GET | `/api/v1/clinic/verification/history` | clinic:profile:read | — |
| POST | `/api/v1/clinic/verification/submit` | clinic:verification:submit | — |
| GET | `/api/v1/clinic/documents` | clinic:document:manage | — |
| POST | `/api/v1/clinic/documents/upload-init` | clinic:document:manage | DocumentUploadInitDto |
| POST | `/api/v1/clinic/documents/complete` | clinic:document:manage | DocumentCompleteDto |
| GET | `/api/v1/clinic/documents/{id}/url` | clinic:document:manage | — |
| GET | `/api/v1/clinic/profile/media` | clinic:profile:read | — |
| POST | `/api/v1/clinic/profile/media/upload-init` | clinic:profile:update | MediaUploadInitDto |
| POST | `/api/v1/clinic/profile/media/complete` | clinic:profile:update | MediaCompleteDto |
| PUT | `/api/v1/clinic/profile/media/order` | clinic:profile:update | MediaOrderDto |
| PATCH | `/api/v1/clinic/profile/media/{id}` | clinic:profile:update | MediaUpdateDto |
| DELETE | `/api/v1/clinic/profile/media/{id}` | clinic:profile:update | — |

## Documents

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| PUT | `/api/v1/documents/{id}/upload` | Signed token | application/pdf, image/jpeg, image/png |
| GET | `/api/v1/documents/{id}/content` | Signed token | — |

## Admin: Practitioners

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/practitioners` | practitioner:read | — |
| POST | `/api/v1/admin/practitioners` | practitioner:review | CreatePractitionerDto |
| GET | `/api/v1/admin/practitioners/{id}` | practitioner:read | — |
| PATCH | `/api/v1/admin/practitioners/{id}` | practitioner:review | UpdatePractitionerDto |
| POST | `/api/v1/admin/practitioners/{id}/credentials` | practitioner:review | CredentialInputDto |
| POST | `/api/v1/admin/practitioners/{id}/credentials/{credentialId}/reveal` | practitioner:review | — |
| POST | `/api/v1/admin/practitioners/{id}/submit` | practitioner:review | — |
| POST | `/api/v1/admin/practitioners/{id}/start-review` | practitioner:review | — |
| POST | `/api/v1/admin/practitioners/{id}/reviews` | practitioner:review | PractitionerReviewDto |
| POST | `/api/v1/admin/practitioners/{id}/status` | practitioner:status | PractitionerStatusDto |

## Admin: Practitioner affiliations

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/practitioner-affiliations` | practitioner:read | — |
| POST | `/api/v1/admin/practitioner-affiliations/{id}/reviews` | practitioner:review | AffiliationReviewDto |

## Clinic: Practitioners

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| POST | `/api/v1/clinic/practitioners/lookup` | affiliation:manage | PractitionerLookupDto |
| GET | `/api/v1/clinic/practitioner-affiliations` | affiliation:read | — |
| POST | `/api/v1/clinic/practitioner-affiliations` | affiliation:manage | ProposeAffiliationDto |
| PATCH | `/api/v1/clinic/practitioner-affiliations/{id}` | affiliation:manage | UpdateAffiliationDto |

## Admin: Practitioner documents

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/practitioners/{id}/documents` | practitioner:review | — |
| POST | `/api/v1/admin/practitioners/{id}/credentials/{credentialId}/documents/upload-init` | practitioner:review | PractitionerDocumentUploadDto |
| POST | `/api/v1/admin/practitioners/{id}/credentials/{credentialId}/documents/complete` | practitioner:review | PractitionerDocumentCompleteDto |
| GET | `/api/v1/admin/practitioners/{id}/credentials/{credentialId}/documents/{documentId}/url` | practitioner:review | — |

## Clinic: Practitioner documents

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/practitioners/{id}/documents` | affiliation:manage | — |
| POST | `/api/v1/clinic/practitioners/{id}/credentials/{credentialId}/documents/upload-init` | affiliation:manage | PractitionerDocumentUploadDto |
| POST | `/api/v1/clinic/practitioners/{id}/credentials/{credentialId}/documents/complete` | affiliation:manage | PractitionerDocumentCompleteDto |
| GET | `/api/v1/clinic/practitioners/{id}/credentials/{credentialId}/documents/{documentId}/url` | affiliation:manage | — |

## Clinic: Offerings

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/offerings/options` | offering:read | — |
| GET | `/api/v1/clinic/offerings` | offering:read | — |
| POST | `/api/v1/clinic/offerings` | offering:create | CreateOfferingDto |
| GET | `/api/v1/clinic/offerings/{id}` | offering:read | — |
| PATCH | `/api/v1/clinic/offerings/{id}` | offering:update | UpdateOfferingDto |
| POST | `/api/v1/clinic/offerings/{id}/publish` | offering:publish | — |
| POST | `/api/v1/clinic/offerings/{id}/unpublish` | offering:publish | — |
| POST | `/api/v1/clinic/offerings/{id}/archive` | offering:update | — |

## Public: Catalog

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/public/facilities` | public | — |
| GET | `/api/v1/public/facilities/{id}` | public | — |
| GET | `/api/v1/public/facilities/{id}/offerings` | public | — |
| GET | `/api/v1/public/facilities/{id}/slots` | public | — |

## Clinic: Availability

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/schedules` | schedule:read | — |
| POST | `/api/v1/clinic/schedules` | schedule:manage | CreateScheduleDto |
| PATCH | `/api/v1/clinic/schedules/{id}` | schedule:manage | UpdateScheduleDto |
| GET | `/api/v1/clinic/schedule-blocks` | schedule:read | — |
| POST | `/api/v1/clinic/schedule-blocks` | schedule:manage | CreateBlockDto |
| DELETE | `/api/v1/clinic/schedule-blocks/{id}` | schedule:manage | — |
| GET | `/api/v1/clinic/slots` | schedule:read | — |

## Bookings

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| POST | `/api/v1/bookings` | Booking API key | CreateBookingDto |

## Clinic: Orders

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/clinic/orders` | order:read | — |
| GET | `/api/v1/clinic/orders/{id}` | order:read | — |
| POST | `/api/v1/clinic/orders/{id}/approve` | order:approve | — |
| POST | `/api/v1/clinic/orders/{id}/reject` | order:approve | RejectOrderDto |
| POST | `/api/v1/clinic/orders/{id}/cancel` | order:approve | CancelOrderDto |
| GET | `/api/v1/clinic/orders/{id}/assignable-practitioners` | order:assign | — |
| POST | `/api/v1/clinic/orders/{id}/assignments` | order:assign | AssignPractitionerDto |
| DELETE | `/api/v1/clinic/orders/{id}/assignments/{assignmentId}` | order:assign | — |
| GET | `/api/v1/clinic/orders/{id}/reschedule-slots` | order:approve | — |
| POST | `/api/v1/clinic/orders/{id}/reschedule` | order:approve | RescheduleOrderDto |
| POST | `/api/v1/clinic/orders/{id}/no-show` | order:progress | NoShowOrderDto |
| POST | `/api/v1/clinic/orders/{id}/start` | order:progress | — |
| PATCH | `/api/v1/clinic/orders/{id}/items/{itemId}/status` | order:progress | ItemStatusDto |
| POST | `/api/v1/clinic/orders/{id}/complete` | order:progress | — |

## Admin: Orders

| Method | Endpoint | Akses / permission | Request body |
|---|---|---|---|
| GET | `/api/v1/admin/orders` | order:read-all | — |
| GET | `/api/v1/admin/orders/{id}` | order:read-all | — |

