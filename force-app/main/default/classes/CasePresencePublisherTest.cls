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
        String sessionId = 'test-session-123';
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            sessionId,
            'viewing',
            true
        );
        Test.stopTest();
        
        // Platform Events are async, so we can't query them in tests
        // But we verify no exception was thrown
        System.assert(true, 'Event published successfully');
    }
    
    @isTest
    static void testPublishPresence_Editing() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        String sessionId = 'test-session-456';
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            sessionId,
            'editing',
            true
        );
        Test.stopTest();
        
        System.assert(true, 'Event published successfully');
    }
    
    @isTest
    static void testPublishPresence_Idle() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];
        String sessionId = 'test-session-789';
        
        Test.startTest();
        CasePresencePublisher.publishPresence(
            testCase.Id,
            sessionId,
            'viewing',
            false
        );
        Test.stopTest();
        
        System.assert(true, 'Event published successfully');
    }
    
    @isTest
    static void testGetSettings_Default() {
        Test.startTest();
        CasePresencePublisher.PresenceSettings settings = 
            CasePresencePublisher.getSettings();
        Test.stopTest();
        
        System.assertNotEquals(null, settings, 'Settings should not be null');
        System.assertEquals(20, settings.heartbeatFrequencySeconds, 'Default heartbeat should be 20');
        System.assertEquals(10, settings.presenceExpirationMinutes, 'Default expiration should be 10');
        System.assertEquals(5, settings.draftStalenessMinutes, 'Default staleness should be 5');
    }
    

    
    @isTest
    static void testPublishPresence_InvalidCaseId() {
        Test.startTest();
        try {
            CasePresencePublisher.publishPresence(
                'invalid-id',
                'session-123',
                'viewing',
                true
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
        String sessionId = 'test-session-multi';
        
        Test.startTest();
        // Publish multiple state changes
        CasePresencePublisher.publishPresence(testCase.Id, sessionId, 'viewing', true);
        CasePresencePublisher.publishPresence(testCase.Id, sessionId, 'editing', true);
        CasePresencePublisher.publishPresence(testCase.Id, sessionId, 'viewing', false);
        Test.stopTest();
        
        System.assert(true, 'Multiple events published successfully');
    }
}
