# MISSION ISOLATION FIX - VERIFICATION CHECKLIST

## Pre-Deployment Verification

### Code Quality Checks

- [ ] Backend Python syntax check passed

  ```bash
  python -m py_compile backend/main.py
  ```

- [ ] Frontend lint check passed

  ```bash
  cd frontend && npm run lint
  ```

- [ ] Frontend build successful

  ```bash
  cd frontend && npm run build
  ```

- [ ] No TypeScript errors in frontend
  ```bash
  cd frontend && npx tsc --noEmit
  ```

### Unit Tests

- [ ] Backend video hash function works correctly
  - [ ] compute_video_sha256() returns 64-char hex string
  - [ ] Handles missing files gracefully
  - [ ] Produces consistent hash for same file
  - [ ] Detects file changes (hash changes)

- [ ] Frontend mission fetch works correctly
  - [ ] getMission() returns API mission when available
  - [ ] getMission() returns seeded mission for matching ID
  - [ ] getMission() returns error state for unknown mission
  - [ ] Cache working correctly

### Integration Tests

- [ ] Test mission creation workflow

  ```
  1. POST /api/missions (create mission)
  2. Verify mission JSON created in data/missions/
  3. Verify mission.status = "created"
  4. Verify mission.video = null
  ```

- [ ] Test video upload workflow

  ```
  1. POST /api/missions/{id}/upload
  2. Verify video file saved to data/missions/{id}/video.{ext}
  3. Verify mission.video.sha256 is set
  4. Verify mission.video.path is absolute path
  5. Verify upload response includes sha256
  ```

- [ ] Test video processing workflow

  ```
  1. POST /api/missions/{id}/process
  2. Verify MISSION_PROCESS_START log appears
  3. Verify detections.mission_id = mission_id
  4. Verify detections.video_sha256 set
  5. Verify status = "processing_complete"
  ```

- [ ] Test missing video error handling

  ```
  1. Create and upload mission A
  2. Delete data/missions/A/video.mp4 file
  3. POST /api/missions/A/process
  4. Verify response status = "UNAVAILABLE"
  5. Verify response error = "MISSION_VIDEO_NOT_AVAILABLE"
  ```

- [ ] Test video hash mismatch detection

  ```
  1. Create and upload mission B
  2. Modify data/missions/B/video.mp4 (append data)
  3. POST /api/missions/B/process
  4. Verify HTTPException with hash mismatch message
  ```

- [ ] Test duplicate video detection

  ```
  1. Create mission A, upload video
  2. Create mission B, upload SAME video
  3. Check server logs for DUPLICATE_VIDEO_DETECTED
  4. Check server logs for VIDEO_SHARED_ACROSS_MISSIONS
  5. Verify both missions process correctly with different results
       (IF they have different frames analyzed)
  ```

- [ ] Test frontend mission switching
  ```
  1. Create missions A and B with different videos
  2. Process both missions
  3. User selects mission A in UI
  4. Frontend fetches mission A data
  5. Displays mission A's detections
  6. User switches to mission B
  7. Frontend fetches mission B data
  8. Displays mission B's detections (different from A)
  9. Switch back to A
  10. Mission A data still correct (not corrupted by B)
  ```

### Data Validation

- [ ] Existing missions checked
  - [ ] 040bcc51-8e0: Has video.sha256?
  - [ ] 46bd52d9-1e2: Has video.sha256?
  - [ ] 726dfe3f-b1e: Has video.sha256?
  - [ ] 9168ef98-95e: Has video.sha256?
  - [ ] Check: Do all 4 have same sha256? (Should be yes - confirms bug)

- [ ] Video file integrity
  - [ ] All mission videos exist in data/missions/
  - [ ] No mission has empty video.path
  - [ ] No mission has empty video.sha256 (except old ones)

### Log Review

Backend logs should show:

```
✓ MISSION_VIDEO_HASH mission_id=xxx file=video.mp4 sha256=ABC123...
✓ MISSION_PROCESS_START mission_id=xxx video_hash=ABC123...
✓ DUPLICATE_VIDEO_DETECTED [if duplicate found]
✓ VIDEO_SHARED_ACROSS_MISSIONS [if sharing detected]
```

Frontend console logs should show:

```
✓ [Mission] Cache hit for mission xxx
✓ [Mission] Loaded mission xxx from API
✓ [Upload] Video uploaded successfully for mission xxx
✓ [Process] Processing completed for mission xxx
```

### Error Handling

- [ ] Graceful handling of network errors
  - [ ] Backend unavailable: Returns fallback seeded mission
  - [ ] Mission not found: Returns error state, not another mission
  - [ ] Invalid mission ID: Returns mission_not_found error

- [ ] Graceful handling of video errors
  - [ ] Missing video: Returns UNAVAILABLE error
  - [ ] Corrupted video: Hash mismatch error
  - [ ] Invalid video format: Upload rejection

### Security Checks

- [ ] Video hash cannot be spoofed
  - [ ] Hash is computed fresh on process
  - [ ] Hash is read-only once stored
  - [ ] Any file modification detected

- [ ] Mission isolation enforced
  - [ ] Cannot process another mission's video
  - [ ] Cannot retrieve another mission's data
  - [ ] Cannot mix detections from different missions

- [ ] Access control (if applicable)
  - [ ] Only authorized users can upload
  - [ ] Only authorized users can process
  - [ ] Audit trail of who did what

### Performance Checks

- [ ] Video hash computation doesn't slow down processing
  - [ ] Upload with large video: < 5 seconds
  - [ ] Process endpoint: same speed as before
  - [ ] No memory leaks with large videos

- [ ] Cache performance
  - [ ] Mission cache reduces API calls
  - [ ] Cache invalidation works correctly
  - [ ] No stale data served

### Regression Tests

- [ ] Seeded missions still work
  - [ ] north-ridge loads correctly
  - [ ] downtown-grid loads correctly
  - [ ] harbor-district loads correctly
  - [ ] river-approach loads correctly

- [ ] Existing API endpoints unchanged
  - [ ] GET /api/missions returns all missions
  - [ ] GET /api/missions/{id} returns mission
  - [ ] PUT/PATCH endpoints unchanged
  - [ ] DELETE endpoints unchanged

- [ ] Frontend components still work
  - [ ] MissionsPage displays missions
  - [ ] MissionSelectorPanel switches missions
  - [ ] ProcessingProgress page works
  - [ ] 3D viewer displays reconstruction

---

## Deployment Checklist

### Pre-Deployment

- [ ] Code review approved
- [ ] All tests passing
- [ ] Staging environment tested
- [ ] Deployment plan reviewed
- [ ] Rollback plan prepared

### During Deployment

- [ ] Stop production backend
- [ ] Backup mission data: `cp -r data/missions data/missions.backup.$(date +%s)`
- [ ] Deploy new backend code
- [ ] Restart backend
- [ ] Monitor logs for errors
- [ ] Run smoke tests

### Post-Deployment

- [ ] Verify all existing missions accessible
- [ ] Verify new mission creation works
- [ ] Verify video upload works
- [ ] Verify processing works
- [ ] Verify frontend loads missions
- [ ] Check backend logs for errors
- [ ] Check frontend console for errors
- [ ] Monitor for 24 hours
- [ ] Backup production data: `cp -r data/missions data/missions.backup.prod.$(date +%s)`

### Rollback Procedure

- [ ] If critical error: restore from backup
  ```bash
  mv data/missions data/missions.broken
  cp -r data/missions.backup.TIMESTAMP data/missions
  ```
- [ ] Restart backend
- [ ] Verify missions accessible
- [ ] Investigate error
- [ ] Plan fix

---

## Post-Deployment: Data Cleanup

### Generate Cleanup Report

```bash
python test_mission_isolation.py
# Identifies all missions with duplicate videos
# Generates report of which missions can be safely deleted
```

### Manual Verification

For each identified duplicate mission:

- [ ] Verify it's test data (name, metadata, etc.)
- [ ] Confirm not used in production
- [ ] Get approval before deletion

### Cleanup Execution

```bash
# For each test mission to delete:
rm -rf data/missions/{mission_id}
rm data/missions/{mission_id}.json

# Backup what was deleted:
git add -A data/missions/
git commit -m "Cleanup: Remove duplicate test missions xyz, abc, def"
```

### Post-Cleanup Verification

- [ ] Verify remaining missions still process correctly
- [ ] Verify no broken references
- [ ] Verify database consistency
- [ ] Verify all tests still pass

---

## Success Criteria Met

When ALL of the following are true, mission isolation is FIXED:

- ✅ Each mission has unique video file (verified via SHA-256)
- ✅ Detections are mission-specific (not copied)
- ✅ Video hash stored and validated
- ✅ Duplicate videos detected and logged
- ✅ Missing video causes clear error
- ✅ Frontend never falls back to other missions
- ✅ All tests passing
- ✅ No errors in logs
- ✅ Performance acceptable
- ✅ Existing seeded missions still work

---

## Sign-Off

- [ ] QA: All tests passed
- [ ] DevOps: Deployment successful
- [ ] Product: Feature verified in production
- [ ] Security: No vulnerabilities introduced

**Date Completed**: ******\_\_\_******  
**Verified By**: ******\_\_\_******  
**Notes**: ******\_\_\_******

---

**Checklist Version**: 1.0  
**Last Updated**: 2026-08-31  
**Status**: Ready for verification
