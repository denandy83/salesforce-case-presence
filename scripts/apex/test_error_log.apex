// Test script to verify Error_Log__c insertion logic
try {
    // 1. Get a valid Case ID for the lookup
    Case c = [SELECT Id FROM Case LIMIT 1];
    Id caseId = c.Id;
    
    System.debug('--- Starting Error Log Test ---');
    
    // 2. Create the record using the exact same logic added to the classes
    Error_Log__c testErr = new Error_Log__c(
        Related_Case__c = caseId,
        Error_Description__c = '<b>Test Error</b><br/>This is a test of the Rich Text area and the automated logging logic.',
        More_info__c = System.now() + ' - TestScript',
        Problem_Child__c = 'Case Presence'
    );
    
    insert testErr;
    System.debug('SUCCESS: Error_Log__c record inserted. ID: ' + testErr.Id);
    
    // 3. Verify it exists
    Error_Log__c verified = [
        SELECT Id, Name, Related_Case__c, More_info__c 
        FROM Error_Log__c 
        WHERE Id = :testErr.Id
    ];
    System.debug('Verification - Record Name: ' + verified.Name);
    System.debug('Verification - Case Lookup: ' + verified.Related_Case__c);
    System.debug('Verification - More Info: ' + verified.More_info__c);

} catch (Exception e) {
    System.debug('FAILURE: Could not insert Error_Log__c. Error: ' + e.getMessage());
    System.debug('Stack Trace: ' + e.getStackTraceString());
}
