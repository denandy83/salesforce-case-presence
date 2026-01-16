Case_Presence_Log__c log = new Case_Presence_Log__c(
    Case_Id__c = '500du00000E3G3OAAV',
    User_Id__c = UserInfo.getUserId(), // Use my own ID
    State__c = 'active',
    Last_Updated__c = System.now(),
    User_Name__c = 'Test User',
    IsMobile__c = true
);
System.debug('Attempting upsert...');
CasePresenceLogHandler.upsertPresenceLogs(new List<Case_Presence_Log__c>{log});
System.debug('Upsert call complete.');
