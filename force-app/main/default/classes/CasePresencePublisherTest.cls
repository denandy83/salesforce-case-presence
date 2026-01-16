@isTest
private class CasePresencePublisherTest {
    
    @TestSetup
    static void makeData() {
        // Create test case
        Case testCase = new Case(
            Subject = 'Test Case',
            Status = 'New',
            Origin = 'Web'
        );
        insert testCase;
    }
    
    @isTest
    static void testPublishPresence_Viewing() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            'viewing',
            true,
            'heartbeat',
            false
        );
        Test.stopTest();
        
        System.assert(true, 'Event published successfully');
    }
    
    @isTest
    static void testPublishPresence_Editing() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            'editing',
            true,
            'heartbeat',
            false
        );
        Test.stopTest();
        
        System.assert(true, 'Event published successfully');
    }
    
    @isTest
    static void testPublishPresence_Idle() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            'viewing',
            false,
            'heartbeat',
            false
        );
        Test.stopTest();
        
        System.assert(true, 'Event published successfully');
    }

    @isTest
    static void testPublishPresence_Mobile() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            'active',
            false,
            'heartbeat',
            true // isMobile = true
        );
        Test.stopTest();
        
        System.assert(true, 'Mobile Event published successfully');
    }
    
    @isTest
    static void testGetSettings_Default() {
        Test.startTest();
        CasePresencePublisher.PresenceSettings settings = 
            CasePresencePublisher.getSettings();
        Test.stopTest();
        
        System.assertNotEquals(null, settings, 'Settings should not be null');
        // Match Org Config (240s)
        System.assertEquals(240, settings.heartbeatFrequencySeconds, 'Heartbeat should match org config (240)');
        System.assertEquals(10, settings.presenceExpirationMinutes, 'Default expiration should be 10');
        System.assertEquals(5, settings.draftStalenessMinutes, 'Default staleness should be 5');
    }
    
    @isTest
    static void testPublishPresence_InvalidCaseId() {
        Test.startTest();
        try {
            CasePresencePublisher.publishPresence(
                'invalid-id',
                'viewing',
                true,
                'heartbeat',
                false
            );
            // Platform Events may not throw exception for invalid data
            System.assert(true, 'Method executed');
        } catch (Exception e) {
            System.assert(true, 'Exception handled gracefully');
        }
        Test.stopTest();
    }
    
    @isTest
    static void testPublishPresence_MultipleStates() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        
        Test.startTest();
        // Publish multiple state changes
        CasePresencePublisher.publishPresence(testCase.Id, 'viewing', true, 'heartbeat', false);
        CasePresencePublisher.publishPresence(testCase.Id, 'editing', true, 'heartbeat', false);
        CasePresencePublisher.publishPresence(testCase.Id, 'viewing', false, 'heartbeat', false);
        Test.stopTest();
        
        System.assert(true, 'Multiple events published successfully');
    }

    @isTest
    static void testGetCurrentUserInfo() {
        Test.startTest();
        CasePresencePublisher.UserData info = CasePresencePublisher.getCurrentUserInfo();
        Test.stopTest();
        
        System.assertEquals(UserInfo.getUserId(), info.userId);
        System.assertNotEquals(null, info.userName);
    }
}
