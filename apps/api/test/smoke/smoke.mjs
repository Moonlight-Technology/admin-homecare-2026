// End-to-end smoke test for S2 (facility onboarding + documents) and S3 (practitioners + affiliations)
// against a running API. Usage: node smoke.mjs <apiBaseUrl> <origin> <adminEmail> <adminPassword>
const [base, origin, adminEmail, adminPassword] = process.argv.slice(2);
const results = [];
let failed = 0;

function check(name, condition, detail = '') {
  results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? `  -> ${detail}` : ''}`);
  if (!condition) failed += 1;
  return condition;
}

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).json?.accessToken;
const stamp = Date.now().toString().slice(-8);
const STR = `31${stamp}0011`;
const STR2 = `32${stamp}0022`;
let registration2Id;

async function main() {
  const health = await call('GET', '/health');
  check('API health', health.status === 200, String(health.status));

  const admin = await login(adminEmail, adminPassword);
  if (!check('super admin login', Boolean(admin))) return;

  const options = await call('GET', '/public/master-options');
  const type = options.json?.practitionerTypes?.[0];
  const facilityType = options.json?.facilityTypes?.[0];
  check('public master options include practitioner types', Boolean(type && facilityType), options.text.slice(0, 200));

  // ─── S2: clinic registration, documents, verification ───
  const requirement = await call('POST', '/admin/master/document-requirements', { token: admin, body: { code: `SMOKE_IZIN_${stamp}`, ownerType: 'FACILITY', name: 'Izin operasional (smoke)', mandatory: true } });
  check('admin creates a mandatory facility document requirement', requirement.status === 201, requirement.text.slice(0, 200));

  const ownerEmail = `owner.${stamp}@smoke.test`;
  const ownerPassword = `Smoke-Owner-${stamp}!`;
  const registration = await call('POST', '/clinic-registration', { body: { owner: { name: 'Owner Smoke', email: ownerEmail, password: ownerPassword }, facility: { displayName: `Klinik Smoke ${stamp}`, legalName: `PT Klinik Smoke ${stamp}`, facilityTypeId: facilityType.id, capabilityIds: (options.json.capabilities ?? []).slice(0, 1).map((c) => c.id), phone: '021-5550123', addressLine: 'Jl. Uji Coba No. 1, Jakarta' } } });
  check('clinic self-registration', registration.status === 201, registration.text.slice(0, 200));
  const facilityId = registration.json?.facilityId;
  const owner = await login(ownerEmail, ownerPassword);
  if (!check('clinic owner login', Boolean(owner))) return;

  const early = await call('POST', '/clinic/verification/submit', { token: owner });
  check('submit without the mandatory document is refused (422)', early.status === 422, `${early.status} ${early.json?.code}`);

  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n% smoke test\n'), Buffer.alloc(200, 0x20)]);
  const init = await call('POST', '/clinic/documents/upload-init', { token: owner, body: { requirementId: requirement.json?.id, fileName: 'izin-operasional.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length } });
  check('document upload-init returns a signed upload link', init.status === 201 && Boolean(init.json?.upload?.url), init.text.slice(0, 200));
  check('storage key never reaches the client', !init.text.includes('objectKey'));
  const put = await fetch(init.json.upload.url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  check('PUT bytes to the signed link', put.status === 204, String(put.status));
  const fake = await fetch(init.json.upload.url.replace(/token=[^&]+/, 'token=forged.token'), { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  check('forged upload token is rejected (403)', fake.status === 403, String(fake.status));
  const complete = await call('POST', '/clinic/documents/complete', { token: owner, body: { documentId: init.json.document.id } });
  check('document complete', complete.status === 200 && complete.json?.status === 'UPLOADED', complete.text.slice(0, 200));
  const link = await call('GET', `/clinic/documents/${init.json.document.id}/url`, { token: owner });
  const download = await fetch(link.json?.url);
  const downloaded = Buffer.from(await download.arrayBuffer());
  check('download through the signed link returns the same bytes', download.status === 200 && downloaded.equals(pdf), `${download.status} ${downloaded.length}`);
  check('download is no-store and nosniff', download.headers.get('cache-control')?.includes('no-store') && download.headers.get('x-content-type-options') === 'nosniff');

  const submit = await call('POST', '/clinic/verification/submit', { token: owner });
  check('clinic submits for verification', submit.status === 200, submit.text.slice(0, 200));
  const queue = await call('GET', '/admin/facility-applications?status=SUBMITTED', { token: admin });
  const application = queue.json?.items?.find((item) => item.facility.id === facilityId);
  check('application appears in the admin queue', Boolean(application));
  await call('POST', `/admin/facility-applications/${application?.id}/start-review`, { token: admin });
  const approve = await call('POST', `/admin/facility-applications/${application?.id}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  check('admin approves the clinic', approve.status === 200 && approve.json?.facility?.verificationStatus === 'VERIFIED', approve.text.slice(0, 200));

  // ─── S3: practitioners ───
  const forbidden = await call('GET', '/admin/practitioners', { token: owner });
  check('clinic cannot open admin practitioner routes (403)', forbidden.status === 403, String(forbidden.status));

  const created = await call('POST', '/admin/practitioners', { token: admin, body: { fullName: 'dr. Smoke Pertama', practitionerTypeId: type.id, phone: null, email: null, credentials: [{ credentialType: 'STR', number: STR, issuingAuthority: 'KKI', validFrom: '2024-01-01', validUntil: null }] } });
  check('admin registers a practitioner (SUBMITTED)', created.status === 201 && created.json?.verificationStatus === 'SUBMITTED', created.text.slice(0, 300));
  check('credential number is masked in responses', created.json?.credentials?.[0]?.numberMasked?.endsWith(STR.slice(-4)) && !created.text.includes(STR));
  const practitionerId = created.json?.id;

  const duplicate = await call('POST', '/admin/practitioners', { token: admin, body: { fullName: 'dr. Duplikat', practitionerTypeId: type.id, credentials: [{ credentialType: 'STR', number: STR.replace(/(\d{4})/g, '$1 ') }] } });
  check('same STR (different spacing) is refused as PRACTITIONER_EXISTS', duplicate.status === 409 && duplicate.json?.code === 'PRACTITIONER_EXISTS', `${duplicate.status} ${duplicate.json?.code}`);

  const reveal = await call('POST', `/admin/practitioners/${practitionerId}/credentials/${created.json?.credentials?.[0]?.id}/reveal`, { token: admin });
  check('reviewer can reveal the full number', reveal.json?.number === STR, reveal.text.slice(0, 120));

  const searched = await call('GET', `/admin/practitioners?search=${STR}`, { token: admin });
  check('admin search by full STR finds the practitioner', searched.json?.items?.some((item) => item.id === practitionerId));

  const lookup = await call('POST', '/clinic/practitioners/lookup', { token: owner, body: { strNumber: STR } });
  check('clinic finds the practitioner by exact STR', lookup.status === 200 && lookup.json?.id === practitionerId, lookup.text.slice(0, 200));
  const unknown = await call('POST', '/clinic/practitioners/lookup', { token: owner, body: { strNumber: '9999999999999' } });
  check('unknown STR answers 404', unknown.status === 404, String(unknown.status));

  const proposal = await call('POST', '/clinic/practitioner-affiliations', { token: owner, body: { practitionerId, note: 'Dokter umum homecare' } });
  check('clinic proposes an affiliation (PROPOSED)', proposal.status === 201 && proposal.json?.status === 'PROPOSED', proposal.text.slice(0, 200));
  const again = await call('POST', '/clinic/practitioner-affiliations', { token: owner, body: { practitionerId } });
  check('second live proposal for the same pair is refused (409)', again.status === 409 && again.json?.code === 'AFFILIATION_EXISTS', `${again.status} ${again.json?.code}`);

  const tooEarly = await call('POST', `/admin/practitioner-affiliations/${proposal.json?.id}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  check('affiliation of an unverified practitioner cannot be approved (422)', tooEarly.status === 422 && tooEarly.json?.code === 'PRACTITIONER_NOT_VERIFIED', `${tooEarly.status} ${tooEarly.json?.code}`);

  const noReason = await call('POST', `/admin/practitioners/${practitionerId}/reviews`, { token: admin, body: { decision: 'REJECT' } });
  check('rejecting without a reason is refused (422)', noReason.status === 422, String(noReason.status));
  await call('POST', `/admin/practitioners/${practitionerId}/start-review`, { token: admin });
  const verified = await call('POST', `/admin/practitioners/${practitionerId}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  check('admin verifies the practitioner (VERIFIED + ACTIVE)', verified.json?.verificationStatus === 'VERIFIED' && verified.json?.operatingStatus === 'ACTIVE', verified.text.slice(0, 200));
  const twice = await call('POST', `/admin/practitioners/${practitionerId}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  check('a second decision is refused (409)', twice.status === 409, String(twice.status));

  const approved = await call('POST', `/admin/practitioner-affiliations/${proposal.json?.id}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  check('admin approves the affiliation (ACTIVE, start date set)', approved.json?.status === 'ACTIVE' && Boolean(approved.json?.startDate), approved.text.slice(0, 200));

  const registered = await call('POST', '/clinic/practitioner-affiliations', { token: owner, body: { practitioner: { fullName: 'Ns. Smoke Kedua', practitionerTypeId: type.id, credentials: [{ credentialType: 'STR', number: STR2 }] }, note: 'Perawat luka' } });
  check('clinic registers a new practitioner while proposing', registered.status === 201 && registered.json?.practitioner?.verificationStatus === 'SUBMITTED', registered.text.slice(0, 300));
  const badNested = await call('POST', '/clinic/practitioner-affiliations', { token: owner, body: { practitioner: { fullName: 'x', practitionerTypeId: type.id, credentials: [] } } });
  check('nested validation errors name practitioner.* fields (422)', badNested.status === 422 && Object.keys(badNested.json?.details?.fields ?? {}).some((key) => key.startsWith('practitioner.')), badNested.text.slice(0, 200));

  const list = await call('GET', '/clinic/practitioner-affiliations', { token: owner });
  check('clinic lists its affiliations with counts', list.json?.total === 2 && list.json?.counts?.ACTIVE === 1 && list.json?.counts?.PROPOSED === 1, list.text.slice(0, 200));
  check('clinic list shows masked credentials only', !list.text.includes(STR) && !list.text.includes(STR2));

  const endNoReason = await call('PATCH', `/clinic/practitioner-affiliations/${proposal.json?.id}`, { token: owner, body: { action: 'END' } });
  check('ending without a reason is refused (422)', endNoReason.status === 422, String(endNoReason.status));
  const ended = await call('PATCH', `/clinic/practitioner-affiliations/${proposal.json?.id}`, { token: owner, body: { action: 'END', reason: 'Kontrak selesai (smoke)' } });
  check('clinic ends the active affiliation', ended.json?.status === 'ENDED' && Boolean(ended.json?.endDate), ended.text.slice(0, 200));
  const withdrawn = await call('PATCH', `/clinic/practitioner-affiliations/${registered.json?.id}`, { token: owner, body: { action: 'WITHDRAW' } });
  check('clinic withdraws the pending proposal', withdrawn.json?.status === 'ENDED', withdrawn.text.slice(0, 200));

  const suspend = await call('POST', `/admin/practitioners/${practitionerId}/status`, { token: admin, body: { action: 'SUSPEND', reason: 'Uji suspend (smoke)' } });
  check('admin suspends the practitioner', suspend.json?.operatingStatus === 'SUSPENDED', suspend.text.slice(0, 200));

  // ─── S4: catalog ───
  const catalogOptions = await call('GET', '/clinic/offerings/options', { token: owner });
  const masterService = catalogOptions.json?.categories?.find((category) => category.slug === 'laboratorium')?.masterServices?.[0];
  check('clinic sees active master services grouped by category', Boolean(masterService), catalogOptions.text.slice(0, 200));

  const offering = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Cek darah lengkap di rumah', basePrice: '150000', durationMinutes: 30, preparationNote: 'Puasa 8 jam', modes: [{ mode: 'HOMECARE', priceOverride: '175000', visitFee: '50000' }, { mode: 'ON_SITE' }] } });
  check('clinic creates an offering as DRAFT with modes (AC-SVC-01)', offering.status === 201 && offering.json?.status === 'DRAFT' && offering.json?.modes?.length === 2, offering.text.slice(0, 300));
  check('money stays exact decimal strings', offering.json?.basePrice === '150000' || offering.json?.basePrice === '150000.00', String(offering.json?.basePrice));
  check('verified clinic offering has no publish blockers', Array.isArray(offering.json?.publishBlockers) && offering.json.publishBlockers.length === 0, JSON.stringify(offering.json?.publishBlockers));
  const offeringId = offering.json?.id;

  const badMode = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Salah', basePrice: '1000', durationMinutes: 30, modes: [{ mode: 'ON_SITE', visitFee: '10000' }] } });
  check('visit fee on on-site is refused (422)', badMode.status === 422, String(badMode.status));
  const badPrice = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Salah', basePrice: '12.345', durationMinutes: 30, modes: [{ mode: 'ON_SITE' }] } });
  check('price with 3 decimals is refused (422)', badPrice.status === 422, String(badPrice.status));

  // A second, unverified clinic.
  const owner2Email = `owner2.${stamp}@smoke.test`;
  const owner2Password = `Smoke-Owner2-${stamp}!`;
  registration2Id = (await call('POST', '/clinic-registration', { body: { owner: { name: 'Owner Dua', email: owner2Email, password: owner2Password }, facility: { displayName: `Klinik Dua ${stamp}`, legalName: `PT Klinik Dua ${stamp}`, facilityTypeId: facilityType.id, capabilityIds: [], phone: '021-5550999', addressLine: 'Jl. Kedua No. 2, Bandung' } } })).json?.facilityId;
  const owner2 = await login(owner2Email, owner2Password);
  check('second clinic owner login', Boolean(owner2));
  const foreign = await call('GET', `/clinic/offerings/${offeringId}`, { token: owner2 });
  check("another clinic's offering answers 404 (AC-SVC-02)", foreign.status === 404, String(foreign.status));
  const foreignPatch = await call('PATCH', `/clinic/offerings/${offeringId}`, { token: owner2, body: { basePrice: '1' } });
  check("another clinic cannot modify the offering (404)", foreignPatch.status === 404, String(foreignPatch.status));
  const draft2 = await call('POST', '/clinic/offerings', { token: owner2, body: { masterServiceId: masterService?.id, name: 'Draf klinik dua', basePrice: '90000', durationMinutes: 20, modes: [{ mode: 'ON_SITE' }] } });
  check('unverified clinic can still prepare a draft', draft2.status === 201 && draft2.json?.publishBlockers?.includes('FACILITY_NOT_VERIFIED'), draft2.text.slice(0, 200));
  const publish2 = await call('POST', `/clinic/offerings/${draft2.json?.id}/publish`, { token: owner2 });
  check('unverified clinic cannot publish (422, AC-FAC-05)', publish2.status === 422 && publish2.json?.code === 'OFFERING_NOT_PUBLISHABLE', `${publish2.status} ${publish2.json?.code}`);

  const hiddenBefore = await call('GET', `/public/facilities/${facilityId}/offerings`);
  check('draft offering is not public', hiddenBefore.status === 200 && hiddenBefore.json?.items?.length === 0, hiddenBefore.text.slice(0, 200));
  const published = await call('POST', `/clinic/offerings/${offeringId}/publish`, { token: owner });
  check('verified clinic publishes the offering', published.status === 200 && published.json?.status === 'PUBLISHED' && Boolean(published.json?.publishedAt), published.text.slice(0, 200));
  const again2 = await call('POST', `/clinic/offerings/${offeringId}/publish`, { token: owner });
  check('publishing twice is refused (409)', again2.status === 409, String(again2.status));

  const publicList = await call('GET', '/public/facilities?mode=HOMECARE');
  const listed = publicList.json?.items?.find((item) => item.id === facilityId);
  check('public facility list shows the clinic for HOMECARE', Boolean(listed) && listed.modes.includes('HOMECARE') && listed.offeringCount === 1, publicList.text.slice(0, 300));
  check('public list never shows the unverified clinic', !publicList.json?.items?.some((item) => item.displayName === `Klinik Dua ${stamp}`));
  check('public facility payload has no owner or verification data', !publicList.text.includes(ownerEmail) && !publicList.text.includes('verificationStatus') && !publicList.text.includes('statusReason'));
  const publicOfferings = await call('GET', `/public/facilities/${facilityId}/offerings?mode=HOMECARE`);
  const homecare = publicOfferings.json?.items?.[0]?.modes?.[0];
  check('public offering shows the homecare price override and visit fee', homecare?.mode === 'HOMECARE' && homecare?.price === '175000.00' && homecare?.visitFee === '50000.00', publicOfferings.text.slice(0, 300));
  const onSite = await call('GET', `/public/facilities/${facilityId}/offerings?mode=ON_SITE`);
  check('on-site falls back to the base price', onSite.json?.items?.[0]?.modes?.[0]?.price === '150000.00', onSite.text.slice(0, 300));

  const breakIt = await call('PATCH', `/clinic/offerings/${offeringId}`, { token: owner, body: { modes: [{ mode: 'HOMECARE', enabled: false }] } });
  check('a published offering cannot lose all its modes (422)', breakIt.status === 422 && breakIt.json?.code === 'OFFERING_WOULD_BREAK', `${breakIt.status} ${breakIt.json?.code}`);
  const repriced = await call('PATCH', `/clinic/offerings/${offeringId}`, { token: owner, body: { basePrice: '160000' } });
  check('a published offering can be repriced', repriced.status === 200 && repriced.json?.basePrice?.startsWith('160000'), repriced.text.slice(0, 200));
  const locked = await call('PATCH', `/clinic/offerings/${offeringId}`, { token: owner, body: { masterServiceId: catalogOptions.json?.categories?.[1]?.masterServices?.[0]?.id } });
  check('master service is locked after publication (422)', locked.status === 422 && locked.json?.code === 'MASTER_SERVICE_LOCKED', `${locked.status} ${locked.json?.code}`);
  const archivePublished = await call('POST', `/clinic/offerings/${offeringId}/archive`, { token: owner });
  check('a published offering cannot be archived (409)', archivePublished.status === 409, String(archivePublished.status));

  const suspendClinic = await call('POST', `/admin/facilities/${facilityId}/status`, { token: admin, body: { action: 'SUSPEND', reason: 'Uji suspend klinik (smoke)' } });
  check('admin suspends the clinic', suspendClinic.json?.operatingStatus === 'SUSPENDED', suspendClinic.text.slice(0, 200));
  const goneFacility = await call('GET', `/public/facilities/${facilityId}`);
  check('suspended clinic disappears from public (404)', goneFacility.status === 404, String(goneFacility.status));
  const goneList = await call('GET', '/public/facilities');
  check('suspended clinic is not in the public list', !goneList.json?.items?.some((item) => item.id === facilityId));
  const stillPublished = await call('GET', `/clinic/offerings/${offeringId}`, { token: owner });
  check('suspension blocks publishing without changing the offering', stillPublished.json?.status === 'PUBLISHED' && stillPublished.json?.publishBlockers?.includes('FACILITY_NOT_ACTIVE'), stillPublished.text.slice(0, 200));
  await call('POST', `/admin/facilities/${facilityId}/status`, { token: admin, body: { action: 'ACTIVATE' } });
  const back = await call('GET', `/public/facilities/${facilityId}`);
  check('reactivated clinic is public again', back.status === 200, String(back.status));

  const unpublished = await call('POST', `/clinic/offerings/${offeringId}/unpublish`, { token: owner });
  check('clinic unpublishes the offering', unpublished.json?.status === 'UNPUBLISHED', unpublished.text.slice(0, 200));
  const hiddenAfter = await call('GET', `/public/facilities/${facilityId}/offerings`);
  check('unpublished offering leaves the public catalog', hiddenAfter.json?.items?.length === 0, hiddenAfter.text.slice(0, 200));
  const archived = await call('POST', `/clinic/offerings/${offeringId}/archive`, { token: owner });
  check('clinic archives the unpublished offering', archived.json?.status === 'ARCHIVED', archived.text.slice(0, 200));
  const editArchived = await call('PATCH', `/clinic/offerings/${offeringId}`, { token: owner, body: { name: 'Tidak boleh' } });
  check('archived offering is read-only (409)', editArchived.status === 409, String(editArchived.status));
  const activeList = await call('GET', '/clinic/offerings', { token: owner });
  check('default clinic list hides archived offerings', activeList.json?.items?.every((item) => item.status !== 'ARCHIVED') && activeList.json?.counts?.ARCHIVED === 1, activeList.text.slice(0, 200));

  // ─── S5: availability ───
  const jakartaToday = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(`${jakartaToday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const tomorrowDow = new Date(`${tomorrow}T00:00:00Z`).getUTCDay();
  const utc = (hhmm) => new Date(Date.parse(`${tomorrow}T${hhmm}:00+07:00`)).toISOString();

  const schedule = await call('POST', '/clinic/schedules', { token: owner, body: { mode: 'HOMECARE', dayOfWeek: tomorrowDow, startTime: '08:00', endTime: '12:00', slotMinutes: 60, capacityPerSlot: 2 } });
  check('clinic adds weekly homecare hours', schedule.status === 201 && schedule.json?.active === true, schedule.text.slice(0, 200));
  const overlap = await call('POST', '/clinic/schedules', { token: owner, body: { mode: 'HOMECARE', dayOfWeek: tomorrowDow, startTime: '11:00', endTime: '13:00', slotMinutes: 60, capacityPerSlot: 1 } });
  check('overlapping hours of the same mode are refused (409)', overlap.status === 409 && overlap.json?.code === 'SCHEDULE_OVERLAP', `${overlap.status} ${overlap.json?.code}`);
  const onSiteSchedule = await call('POST', '/clinic/schedules', { token: owner, body: { mode: 'ON_SITE', dayOfWeek: tomorrowDow, startTime: '09:00', endTime: '10:00', slotMinutes: 30, capacityPerSlot: 1 } });
  check('the other mode may use the same hours', onSiteSchedule.status === 201, onSiteSchedule.text.slice(0, 200));
  const foreignSchedule = await call('PATCH', `/clinic/schedules/${schedule.json?.id}`, { token: owner2, body: { capacityPerSlot: 50 } });
  check("another clinic cannot change this clinic's schedule (404)", foreignSchedule.status === 404, String(foreignSchedule.status));

  const clinicSlots = await call('GET', `/clinic/slots?mode=HOMECARE&from=${tomorrow}&days=1`, { token: owner });
  check('clinic sees 4 hourly slots with capacity 2', clinicSlots.json?.slots?.length === 4 && clinicSlots.json.slots.every((slot) => slot.capacity === 2 && slot.remaining === 2), clinicSlots.text.slice(0, 300));
  check('slot times are Jakarta wall time in UTC', clinicSlots.json?.slots?.[0]?.startsAt === utc('08:00'), String(clinicSlots.json?.slots?.[0]?.startsAt));

  const block = await call('POST', '/clinic/schedule-blocks', { token: owner, body: { startDate: tomorrow, startTime: '10:00', endTime: '11:00', reason: 'Rapat internal (smoke)' } });
  check('clinic blocks a time range for all modes', block.status === 201 && block.json?.mode === null && block.json?.startsAt === utc('10:00'), block.text.slice(0, 200));
  const blockedSlots = await call('GET', `/clinic/slots?mode=HOMECARE&from=${tomorrow}&days=1`, { token: owner });
  check('the blocked hour is marked in the clinic view', blockedSlots.json?.slots?.find((slot) => slot.startsAt === utc('10:00'))?.blocked === true);

  const longService = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Paket 90 menit', basePrice: '300000', durationMinutes: 90, modes: [{ mode: 'HOMECARE' }] } });
  await call('POST', `/clinic/offerings/${longService.json?.id}/publish`, { token: owner });
  const fit = await call('GET', `/public/facilities/${facilityId}/slots?date=${tomorrow}&mode=HOMECARE&offeringIds=${longService.json?.id}`);
  check('public slots only offer starts where a 90-minute visit fits around the block', fit.status === 200 && fit.json?.durationMinutes === 90 && JSON.stringify(fit.json?.slots?.map((slot) => slot.startsAt)) === JSON.stringify([utc('08:00')]), fit.text.slice(0, 300));
  check('public slot end time includes the visit duration', fit.json?.slots?.[0]?.endsAt === utc('09:30'), String(fit.json?.slots?.[0]?.endsAt));
  const plain = await call('GET', `/public/facilities/${facilityId}/slots?date=${tomorrow}&mode=HOMECARE`);
  check('without services every unblocked start is offered', plain.json?.slots?.length === 3, plain.text.slice(0, 300));
  const wrongOffering = await call('GET', `/public/facilities/${facilityId}/slots?date=${tomorrow}&mode=ON_SITE&offeringIds=${longService.json?.id}`);
  check('a service not offered in that mode is refused (422)', wrongOffering.status === 422 && wrongOffering.json?.code === 'OFFERING_NOT_AVAILABLE', `${wrongOffering.status} ${wrongOffering.json?.code}`);
  const past = await call('GET', `/public/facilities/${facilityId}/slots?date=2020-01-01&mode=HOMECARE`);
  check('past dates are refused (422)', past.status === 422 && past.json?.code === 'DATE_OUT_OF_RANGE', `${past.status} ${past.json?.code}`);
  const unverifiedSlots = await call('GET', `/public/facilities/${registration2Id ?? '00000000-0000-0000-0000-000000000000'}/slots?date=${tomorrow}&mode=HOMECARE`);
  check('an unverified clinic has no public slots (404)', unverifiedSlots.status === 404, String(unverifiedSlots.status));

  await call('DELETE', `/clinic/schedule-blocks/${block.json?.id}`, { token: owner });
  const unblocked = await call('GET', `/public/facilities/${facilityId}/slots?date=${tomorrow}&mode=HOMECARE&offeringIds=${longService.json?.id}`);
  check('removing the block frees the 09:00 and 10:00 starts', unblocked.json?.slots?.length === 3, unblocked.text.slice(0, 300));
  const closed = await call('PATCH', `/clinic/schedules/${schedule.json?.id}`, { token: owner, body: { active: false } });
  const noSlots = await call('GET', `/public/facilities/${facilityId}/slots?date=${tomorrow}&mode=HOMECARE`);
  check('deactivating the hours removes the slots', closed.json?.active === false && noSlots.json?.slots?.length === 0, noSlots.text.slice(0, 200));

  // ─── S6: bookings and orders ───
  const bookingKey = process.env.SMOKE_BOOKINGS_KEY;
  const dayAfter = new Date(Date.parse(`${jakartaToday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const dayAfterDow = new Date(`${dayAfter}T00:00:00Z`).getUTCDay();
  const at = (hhmm) => new Date(Date.parse(`${dayAfter}T${hhmm}:00+07:00`)).toISOString();
  await call('POST', '/clinic/schedules', { token: owner, body: { mode: 'HOMECARE', dayOfWeek: dayAfterDow, startTime: '08:00', endTime: '12:00', slotMinutes: 60, capacityPerSlot: 1 } });
  await call('POST', '/clinic/schedules', { token: owner, body: { mode: 'ON_SITE', dayOfWeek: dayAfterDow, startTime: '08:00', endTime: '09:00', slotMinutes: 60, capacityPerSlot: 1 } });
  const svcA = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Cek darah (order)', basePrice: '150000', durationMinutes: 30, modes: [{ mode: 'HOMECARE', visitFee: '50000' }, { mode: 'ON_SITE' }] } });
  const svcB = await call('POST', '/clinic/offerings', { token: owner, body: { masterServiceId: masterService?.id, name: 'Gula darah (order)', basePrice: '40000', durationMinutes: 15, modes: [{ mode: 'HOMECARE', priceOverride: '45000', visitFee: '75000' }] } });
  await call('POST', `/clinic/offerings/${svcA.json?.id}/publish`, { token: owner });
  await call('POST', `/clinic/offerings/${svcB.json?.id}/publish`, { token: owner });

  const bookingBody = (overrides = {}) => ({ customerId: '11111111-1111-4111-8111-111111111111', patient: { id: '22222222-2222-4222-8222-222222222222', name: 'Siti Rahma', phone: '0812-3456-7890', sex: 'FEMALE', birthYear: 1990 }, facilityId, mode: 'HOMECARE', scheduledAt: at('08:00'), items: [{ offeringId: svcA.json?.id }, { offeringId: svcB.json?.id, quantity: 2 }], address: { line: 'Jl. Kenanga No. 5, Jakarta', note: 'Pagar hijau' }, ...overrides });
  const book = (body, key, auth = bookingKey) => call('POST', '/bookings', { body, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) } });

  const noKey = await book(bookingBody(), `smoke-${stamp}-x`, '');
  check('booking without the machine key is refused (401)', noKey.status === 401, String(noKey.status));
  const badKey = await book(bookingBody(), `smoke-${stamp}-x`, 'wrong-key');
  check('booking with a wrong machine key is refused (401)', badKey.status === 401, String(badKey.status));
  const noIdem = await book(bookingBody(), '');
  check('booking without Idempotency-Key is refused (422)', noIdem.status === 422, String(noIdem.status));
  const orderA = await book(bookingBody(), `smoke-${stamp}-A`);
  check('valid booking creates one PENDING_APPROVAL order with 2 snapshot items (AC-ORD-01)', orderA.status === 201 && orderA.json?.status === 'PENDING_APPROVAL' && orderA.json?.items?.length === 2, orderA.text.slice(0, 300));
  check('booking totals: 150.000 + 2×45.000 + one 75.000 visit fee = 315.000', orderA.json?.itemSubtotal === '240000' && orderA.json?.feeTotal === '75000' && orderA.json?.grandTotal === '315000', `${orderA.json?.itemSubtotal} ${orderA.json?.feeTotal} ${orderA.json?.grandTotal}`);
  const replayA = await book(bookingBody(), `smoke-${stamp}-A`);
  check('retry with the same Idempotency-Key returns the same order (AC-ORD-10)', replayA.status === 201 && replayA.json?.id === orderA.json?.id, `${replayA.status} ${replayA.json?.id}`);
  const foreignItem = await book(bookingBody({ items: [{ offeringId: svcA.json?.id }, { offeringId: draft2.json?.id }] }), `smoke-${stamp}-F`);
  check("booking with another clinic's service is refused (AC-ORD-02)", foreignItem.status === 422 && foreignItem.json?.code === 'BOOKING_ITEMS_INVALID', `${foreignItem.status} ${foreignItem.json?.code}`);
  const badTime = await book(bookingBody({ scheduledAt: at('07:00') }), `smoke-${stamp}-T`);
  check('booking outside the schedule is refused (422 SLOT_UNAVAILABLE)', badTime.status === 422 && badTime.json?.code === 'SLOT_UNAVAILABLE', `${badTime.status} ${badTime.json?.code}`);
  const noAddress = await book(bookingBody({ address: undefined }), `smoke-${stamp}-N`);
  check('homecare booking without address is refused (422)', noAddress.status === 422, String(noAddress.status));
  const orderB = await book(bookingBody({ patient: { id: '33333333-3333-4333-8333-333333333333', name: 'Budi Santoso' }, customerId: '44444444-4444-4444-8444-444444444444' }), `smoke-${stamp}-B`);
  check('a second booking for the same slot is accepted while pending (no tentative holds)', orderB.status === 201, orderB.text.slice(0, 200));
  const orderD = await book(bookingBody({ mode: 'ON_SITE', items: [{ offeringId: svcA.json?.id }], address: undefined, patient: { id: '55555555-5555-4555-8555-555555555555', name: 'Dewi Lestari' } }), `smoke-${stamp}-D`);
  check('on-site booking at the same time is accepted', orderD.status === 201, orderD.text.slice(0, 200));

  const inbox = await call('GET', '/clinic/orders?status=PENDING_APPROVAL', { token: owner });
  check('clinic inbox shows the 3 pending orders with patient names', inbox.json?.total === 3 && inbox.json?.items?.some((item) => item.patientName === 'Siti Rahma'), inbox.text.slice(0, 300));
  const otherInbox = await call('GET', '/clinic/orders', { token: owner2 });
  check('another clinic sees none of these orders (AC-ORD-07)', otherInbox.json?.total === 0, otherInbox.text.slice(0, 200));
  const otherDetail = await call('GET', `/clinic/orders/${orderA.json?.id}`, { token: owner2 });
  check("another clinic's order answers 404 (AC-ORD-07)", otherDetail.status === 404, String(otherDetail.status));
  const adminList = await call('GET', `/admin/orders?facilityId=${facilityId}`, { token: admin });
  check('platform order list masks patient names', adminList.json?.items?.some((item) => item.patientName === 'Si** Ra***') && !adminList.text.includes('Siti Rahma'), adminList.text.slice(0, 300));
  const adminDetail = await call('GET', `/admin/orders/${orderA.json?.id}`, { token: admin });
  check('platform order detail has no visit address or full phone', adminDetail.json?.address === null && !adminDetail.text.includes('Kenanga') && !adminDetail.text.includes('3456-7890'), adminDetail.text.slice(0, 300));
  const clinicDetail = await call('GET', `/clinic/orders/${orderA.json?.id}`, { token: owner });
  check('clinic order detail has the visit address and item snapshots', clinicDetail.json?.address?.line?.includes('Kenanga') && clinicDetail.json?.items?.length === 2 && clinicDetail.json?.durationMinutes === 60, clinicDetail.text.slice(0, 300));
  check('clinic order detail never exposes the idempotency key or customer ids', !clinicDetail.text.includes(`smoke-${stamp}-A`) && !clinicDetail.text.includes('11111111-1111'));

  const earlyStart = await call('POST', `/clinic/orders/${orderA.json?.id}/start`, { token: owner });
  check('an unapproved order cannot start (AC-ORD-08)', earlyStart.status === 409 && earlyStart.json?.code === 'ORDER_TRANSITION_NOT_ALLOWED', `${earlyStart.status} ${earlyStart.json?.code}`);
  const rejectNoReason = await call('POST', `/clinic/orders/${orderB.json?.id}/reject`, { token: owner, body: { reason: '' } });
  check('rejecting without a reason is refused (AC-ORD-04)', rejectNoReason.status === 422, String(rejectNoReason.status));

  const [approve1, approve2] = await Promise.all([call('POST', `/clinic/orders/${orderA.json?.id}/approve`, { token: owner }), call('POST', `/clinic/orders/${orderA.json?.id}/approve`, { token: owner })]);
  const statuses = [approve1.status, approve2.status].sort();
  check('two concurrent approvals: one succeeds, the other gets 409 (AC-ORD-06)', statuses[0] === 200 && statuses[1] === 409, `${approve1.status} ${approve1.json?.code ?? ''} / ${approve2.status} ${approve2.json?.code ?? ''}`);
  const approvedA = await call('GET', `/clinic/orders/${orderA.json?.id}`, { token: owner });
  check('approved order is CONFIRMED with exactly one history step and a slot (AC-ORD-03)', approvedA.json?.status === 'CONFIRMED' && approvedA.json?.history?.filter((entry) => entry.newStatus === 'CONFIRMED').length === 1 && Boolean(approvedA.json?.slotId) && Boolean(approvedA.json?.history?.at(-1)?.actor?.name), approvedA.text.slice(0, 300));
  const full = await call('POST', `/clinic/orders/${orderB.json?.id}/approve`, { token: owner });
  check('approving another order into the full slot is refused (409 SLOT_FULL)', full.status === 409 && full.json?.code === 'SLOT_FULL', `${full.status} ${full.json?.code}`);
  const stillPending = await call('GET', `/clinic/orders/${orderB.json?.id}`, { token: owner });
  check('the failed approval left the order pending (no partial side effects)', stillPending.json?.status === 'PENDING_APPROVAL', String(stillPending.json?.status));
  const rejected = await call('POST', `/clinic/orders/${orderB.json?.id}/reject`, { token: owner, body: { reason: 'Slot sudah penuh (smoke)' } });
  check('rejecting with a reason stores it in status and history (AC-ORD-05)', rejected.json?.status === 'REJECTED' && rejected.json?.rejectionReason === 'Slot sudah penuh (smoke)' && rejected.json?.history?.at(-1)?.reason === 'Slot sudah penuh (smoke)', rejected.text.slice(0, 300));
  const slotView = await call('GET', `/clinic/slots?mode=HOMECARE&from=${dayAfter}&days=1`, { token: owner });
  check('the clinic slot view shows the confirmed reservation', slotView.json?.slots?.find((slot) => slot.startsAt === at('08:00'))?.reserved === 1, slotView.text.slice(0, 300));
  const publicAfter = await call('GET', `/public/facilities/${facilityId}/slots?date=${dayAfter}&mode=HOMECARE`);
  check('the full slot disappears from public availability', !publicAfter.json?.slots?.some((slot) => slot.startsAt === at('08:00')), publicAfter.text.slice(0, 300));

  // An active, verified, affiliated practitioner to assign.
  const STR3 = `33${stamp}0033`;
  const nakes = await call('POST', '/admin/practitioners', { token: admin, body: { fullName: 'dr. Smoke Ketiga', practitionerTypeId: type.id, credentials: [{ credentialType: 'STR', number: STR3 }] } });
  await call('POST', `/admin/practitioners/${nakes.json?.id}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  const aff = await call('POST', '/clinic/practitioner-affiliations', { token: owner, body: { practitionerId: nakes.json?.id } });
  await call('POST', `/admin/practitioner-affiliations/${aff.json?.id}/reviews`, { token: admin, body: { decision: 'APPROVE' } });
  const assignable = await call('GET', `/clinic/orders/${orderA.json?.id}/assignable-practitioners`, { token: owner });
  check('assignable list contains the affiliated practitioner without conflicts', assignable.json?.some((item) => item.id === nakes.json?.id && item.conflict === null), assignable.text.slice(0, 300));
  const suspendedAssign = await call('POST', `/clinic/orders/${orderA.json?.id}/assignments`, { token: owner, body: { practitionerId: practitionerId } });
  check('a suspended practitioner with an ended affiliation cannot be assigned (422)', suspendedAssign.status === 422, `${suspendedAssign.status} ${suspendedAssign.json?.code}`);
  const assigned = await call('POST', `/clinic/orders/${orderA.json?.id}/assignments`, { token: owner, body: { practitionerId: nakes.json?.id } });
  check('assigning the affiliated practitioner makes the order ASSIGNED; ownership stays with the clinic (AC-PRA-01)', assigned.status === 201 && assigned.json?.assignmentStatus === 'ASSIGNED' && assigned.json?.facilityId === facilityId, assigned.text.slice(0, 300));

  const approveD = await call('POST', `/clinic/orders/${orderD.json?.id}/approve`, { token: owner });
  check('the overlapping on-site order is approved (its own slot)', approveD.json?.status === 'CONFIRMED', approveD.text.slice(0, 200));
  const conflict = await call('POST', `/clinic/orders/${orderD.json?.id}/assignments`, { token: owner, body: { practitionerId: nakes.json?.id } });
  check('the same practitioner cannot take an overlapping visit (AC-PRA-02)', conflict.status === 409 && conflict.json?.code === 'PRACTITIONER_SCHEDULE_CONFLICT', `${conflict.status} ${conflict.json?.code}`);

  const started = await call('POST', `/clinic/orders/${orderA.json?.id}/start`, { token: owner });
  check('a confirmed, assigned order starts (IN_PROGRESS)', started.json?.status === 'IN_PROGRESS', started.text.slice(0, 200));
  const earlyComplete = await call('POST', `/clinic/orders/${orderA.json?.id}/complete`, { token: owner });
  check('completing with unfinished services is refused (AC-ORD-09)', earlyComplete.status === 422 && earlyComplete.json?.code === 'ORDER_ITEMS_UNFINISHED', `${earlyComplete.status} ${earlyComplete.json?.code}`);
  const [item1, item2] = started.json?.items ?? [];
  const notPerformedNoReason = await call('PATCH', `/clinic/orders/${orderA.json?.id}/items/${item2?.id}/status`, { token: owner, body: { status: 'NOT_PERFORMED' } });
  check('not performed without a reason is refused (422)', notPerformedNoReason.status === 422, String(notPerformedNoReason.status));
  await call('PATCH', `/clinic/orders/${orderA.json?.id}/items/${item1?.id}/status`, { token: owner, body: { status: 'COMPLETED' } });
  const item2Done = await call('PATCH', `/clinic/orders/${orderA.json?.id}/items/${item2?.id}/status`, { token: owner, body: { status: 'NOT_PERFORMED', reason: 'Pasien menolak (smoke)' } });
  check('services reach terminal states', item2Done.json?.items?.every((item) => ['COMPLETED', 'NOT_PERFORMED'].includes(item.status)), item2Done.text.slice(0, 300));
  const completed = await call('POST', `/clinic/orders/${orderA.json?.id}/complete`, { token: owner });
  check('the order completes once every service is terminal', completed.json?.status === 'COMPLETED' && completed.json?.history?.length === 4, completed.text.slice(0, 300));
  const afterComplete = await call('POST', `/clinic/orders/${orderA.json?.id}/approve`, { token: owner });
  check('a completed order cannot be approved again (409)', afterComplete.status === 409, String(afterComplete.status));

  const audit = await call('GET', '/admin/audit-logs?limit=100', { token: admin });
  const events = new Set((audit.json?.items ?? []).map((item) => item.event));
  check('audit log records S3 events', ['PRACTITIONER_CREATED_BY_ADMIN', 'PRACTITIONER_CREDENTIAL_REVEALED', 'PRACTITIONER_VERIFIED', 'AFFILIATION_PROPOSED', 'AFFILIATION_APPROVED', 'AFFILIATION_ENDED'].every((event) => events.has(event)), [...events].join(','));
  check('audit log records S6 events', ['ORDER_SUBMITTED', 'ORDER_APPROVED', 'ORDER_REJECTED', 'ORDER_PRACTITIONER_ASSIGNED', 'ORDER_STARTED', 'ORDER_ITEM_STATUS_CHANGED', 'ORDER_COMPLETED'].every((event) => events.has(event)), [...events].join(','));
  check('audit log records S5 events', ['SCHEDULE_CREATED', 'SCHEDULE_UPDATED', 'SCHEDULE_BLOCK_CREATED', 'SCHEDULE_BLOCK_DELETED'].every((event) => events.has(event)), [...events].join(','));
  check('audit log records S4 events', ['OFFERING_CREATED', 'OFFERING_PUBLISHED', 'OFFERING_UPDATED', 'OFFERING_UNPUBLISHED', 'OFFERING_ARCHIVED'].every((event) => events.has(event)), [...events].join(','));
  check('audit log never contains a plain credential number', !audit.text.includes(STR) && !audit.text.includes(STR2));

  const dashboard = await call('GET', '/admin/dashboard/summary', { token: admin });
  check('platform dashboard counts the pending practitioner', dashboard.status === 200 && dashboard.json?.kpis?.pendingPractitionerReviews >= 1, dashboard.text.slice(0, 200));
}

main()
  .catch((error) => { check('smoke run completed without exceptions', false, error instanceof Error ? error.stack : String(error)); })
  .finally(() => {
    console.log(results.join('\n'));
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  });
