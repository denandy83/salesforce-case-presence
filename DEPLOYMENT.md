# Case Presence Indicator - Deployment Package

## Package Contents

### 1. Custom Metadata Type
```
force-app/main/default/objects/Case_Presence_Settings__mdt/
├── Case_Presence_Settings__mdt.object-meta.xml
├── fields/
│   ├── Heartbeat_Frequency_Seconds__c.field-meta.xml
│   ├── Presence_Expiration_Minutes__c.field-meta.xml
│   └── Draft_Staleness_Minutes__c.field-meta.xml
└── customMetadata/
    └── Case_Presence_Settings.Default.md-meta.xml
```

### 2. Platform Event
```
force-app/main/default/objects/Case_Presence__e/
├── Case_Presence__e.object-meta.xml
└── fields/
    ├── CaseId__c.field-meta.xml
    ├── UserId__c.field-meta.xml
    ├── SessionId__c.field-meta.xml
    ├── State__c.field-meta.xml
    ├── IsActive__c.field-meta.xml
    └── Timestamp__c.field-meta.xml
```

### 3. Apex Classes
```
force-app/main/default/classes/
├── CasePresencePublisher.cls
├── CasePresencePublisher.cls-meta.xml
├── CasePresencePublisherTest.cls
├── CasePresencePublisherTest.cls-meta.xml
├── CasePresenceDraftHandler.cls
├── CasePresenceDraftHandler.cls-meta.xml
├── CasePresenceDraftHandlerTest.cls
└── CasePresenceDraftHandlerTest.cls-meta.xml
```

### 4. Lightning Web Component
```
force-app/main/default/lwc/casePresenceIndicator/
├── casePresenceIndicator.js
├── casePresenceIndicator.html
├── casePresenceIndicator.css
└── casePresenceIndicator.js-meta.xml
```

## Pre-Deployment Checklist

### Environment Verification
- [ ] Salesforce org has Lightning Experience enabled
- [ ] Service Cloud license available
- [ ] Platform Events enabled (Setup > Platform Events)
- [ ] API version 62.0 or higher supported
- [ ] Sufficient Platform Event daily limits (100k/day)

### User Permissions
- [ ] Users have read access to Case object
- [ ] Users have read access to User object
- [ ] Users have read access to FeedItem object
- [ ] No profile restrictions on Platform Events

### Org Limits
- [ ] Check Platform Event daily limit usage
- [ ] Verify API calls available for draft queries
- [ ] Confirm EMP API connections available

## Deployment Steps

### Step 1: Deploy Metadata (Required Order)

#### 1a. Custom Metadata Type
```bash
sfdx force:source:deploy -p force-app/main/default/objects/Case_Presence_Settings__mdt
```
**Verify**: Setup > Custom Metadata Types > Case Presence Settings

#### 1b. Custom Metadata Records
```bash
sfdx force:source:deploy -p force-app/main/default/customMetadata
```
**Verify**: Default record exists with values: 20, 10, 5

#### 1c. Platform Event
```bash
sfdx force:source:deploy -p force-app/main/default/objects/Case_Presence__e
```
**Verify**: Setup > Platform Events > Case Presence

#### 1d. Apex Classes
```bash
sfdx force:source:deploy -p force-app/main/default/classes
```
**Verify**: Setup > Apex Classes (4 classes total)

#### 1e. Lightning Web Component
```bash
sfdx force:source:deploy -p force-app/main/default/lwc/casePresenceIndicator
```
**Verify**: Setup > Lightning Components > casePresenceIndicator

### Step 2: Run Tests
```bash
sfdx force:apex:test:run \
  -n CasePresencePublisherTest,CasePresenceDraftHandlerTest \
  -r human \
  -c \
  -w 10
```

**Expected Results**:
- CasePresencePublisherTest: 7 tests, 100% pass
- CasePresenceDraftHandlerTest: 5 tests, 100% pass
- Overall coverage: 75%+ (requirement met)

### Step 3: Configure Case Page Layout

#### Option A: Lightning App Builder (Recommended)
1. Navigate to a Case record
2. Click Setup (gear icon) > Edit Page
3. Find "Case Presence Indicator" in Components panel
4. Drag to desired location (recommended: above feed or in sidebar)
5. Click Save
6. Click Activation
7. Select org default or assign to profiles/apps
8. Click Save

#### Option B: Programmatic Deployment
Create FlexiPage metadata for automatic deployment:

```xml
<!-- force-app/main/default/flexipages/Case_Record_Page.flexipage-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPageRegions>
        <componentInstances>
            <componentName>casePresenceIndicator</componentName>
        </componentInstances>
        <name>Header</name>
        <type>Region</type>
    </flexiPageRegions>
    <masterLabel>Case Record Page</masterLabel>
    <sobjectType>Case</sobjectType>
    <type>RecordPage</type>
</FlexiPage>
```

### Step 4: Validation Testing

#### Test 1: Basic Presence
1. Open Case record as User A
2. Open same Case as User B in different browser/incognito
3. **Expected**: User B sees User A's avatar within 20 seconds
4. **Expected**: User A sees User B's avatar within 20 seconds

#### Test 2: Edit Detection
1. User A opens Case
2. User B opens Case and clicks "Edit" button
3. **Expected**: User A sees blue border around User B's avatar
4. **Expected**: Toast notification: "User B started editing"

#### Test 3: Draft Detection
1. User A opens Case
2. User B opens Case and starts typing in Chatter feed (don't post)
3. Wait 10 seconds
4. **Expected**: User A sees blue border around User B's avatar

#### Test 4: Idle State
1. User A opens Case (tab focused)
2. User B opens Case, then switches to different tab
3. Wait 20 seconds for heartbeat
4. **Expected**: User A sees User B's avatar at 50% opacity

#### Test 5: Gone State
1. User A opens Case
2. User B opens Case, then closes tab/window
3. Wait 10 minutes
4. **Expected**: User B's avatar disappears from User A's view

#### Test 6: Mobile View
1. Open Case on mobile device or resize browser < 768px
2. Have another user open same Case
3. **Expected**: Text-based list: "John Doe, Sarah Miller (editing)"

## Post-Deployment Verification

### System Health Checks
- [ ] Monitor Platform Event usage (Setup > System Overview)
- [ ] Check debug logs for errors
- [ ] Verify no SOQL query limits hit
- [ ] Review CPU time usage
- [ ] Confirm no EMP API connection issues

### User Feedback Collection
- [ ] Survey users on presence accuracy
- [ ] Collect feedback on toast frequency
- [ ] Assess mobile experience
- [ ] Document any edge cases

## Rollback Plan

### If Issues Occur

#### Option 1: Disable Component
1. Edit Case record page in Lightning App Builder
2. Remove Case Presence Indicator component
3. Save and activate
4. Component will stop functioning immediately

#### Option 2: Stop Heartbeats
1. Navigate to Setup > Custom Metadata Types
2. Edit "Default" record
3. Set Heartbeat_Frequency_Seconds__c = 999999
4. Save
5. Heartbeats will effectively stop

#### Option 3: Full Removal
```bash
# Remove in reverse order
sfdx force:source:delete -p force-app/main/default/lwc/casePresenceIndicator
sfdx force:source:delete -p force-app/main/default/classes/CasePresence*
sfdx force:source:delete -p force-app/main/default/objects/Case_Presence__e
sfdx force:source:delete -p force-app/main/default/customMetadata
sfdx force:source:delete -p force-app/main/default/objects/Case_Presence_Settings__mdt
```

## Troubleshooting Guide

### Issue: Component Not Appearing
**Symptoms**: Component not visible in Lightning App Builder
**Solution**: 
1. Verify deployment completed successfully
2. Check component meta.xml has correct targets
3. Clear browser cache
4. Try different browser

### Issue: No Avatars Showing
**Symptoms**: Component visible but no avatars appear
**Solution**:
1. Open browser console (F12)
2. Check for Platform Event subscription errors
3. Verify Case ID is correct (check recordId in console)
4. Confirm other user is on same Case record
5. Wait 20 seconds for first heartbeat

### Issue: Platform Event Errors
**Symptoms**: Console shows "Error subscribing to platform events"
**Solution**:
1. Verify Platform Events enabled in org
2. Check Case_Presence__e exists
3. Confirm user has access to Platform Events
4. Review daily Platform Event limits

### Issue: High Platform Event Usage
**Symptoms**: Warning emails about Platform Event limits
**Solution**:
1. Increase Heartbeat_Frequency_Seconds__c to 30 or 60
2. Increase Presence_Expiration_Minutes__c to 15 or 20
3. Monitor number of concurrent users
4. Consider scaling plan if needed

## Performance Monitoring

### Key Metrics to Track

| Metric | Location | Target | Action if Exceeded |
|--------|----------|--------|-------------------|
| Platform Events/Day | Setup > System Overview | < 50,000 | Increase heartbeat frequency |
| SOQL Queries/Hour | Debug Logs | < 5,000 | Increase draft polling interval |
| CPU Time | Debug Logs | < 5,000ms | Review draft query optimization |
| EMP API Connections | Browser Console | < 10 errors/day | Check network stability |

### Weekly Review Checklist
- [ ] Review Platform Event usage trend
- [ ] Check debug logs for errors
- [ ] Verify toast notifications working
- [ ] Test with multiple concurrent users
- [ ] Review user feedback

## Production Readiness

### Before Going Live
- [ ] All tests passing with 75%+ coverage
- [ ] Deployment successful in sandbox
- [ ] User acceptance testing completed
- [ ] Performance monitoring in place
- [ ] Rollback plan documented and tested
- [ ] Support team trained on troubleshooting
- [ ] User documentation distributed

### Go-Live Checklist
- [ ] Deploy during maintenance window
- [ ] Monitor for first 2 hours post-deployment
- [ ] Verify with pilot users
- [ ] Announce to all users
- [ ] Provide support contact information

## Support Information

### For Administrators
- Review README.md for detailed documentation
- Check DEPLOYMENT.md for deployment steps
- Monitor Platform Event usage weekly
- Collect user feedback monthly

### For Users
- Component appears automatically on Case records
- No configuration needed
- Report issues to Salesforce admin
- Provide feedback on accuracy and usefulness

### For Developers
- All code in force-app/main/default
- Test classes provide 75%+ coverage
- Follow Salesforce LWC best practices
- Review inline comments for logic details

## Version Information
- **Package Version**: 1.0.0
- **API Version**: 62.0
- **Last Updated**: 2025-01-01
- **Compatibility**: Winter '25 and later
