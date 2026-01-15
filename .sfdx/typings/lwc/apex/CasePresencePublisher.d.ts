declare module "@salesforce/apex/CasePresencePublisher.publishPresence" {
  export default function publishPresence(param: {caseId: any, state: any, hasDraft: any, callType: any}): Promise<any>;
}
declare module "@salesforce/apex/CasePresencePublisher.getSettings" {
  export default function getSettings(): Promise<any>;
}
declare module "@salesforce/apex/CasePresencePublisher.getCurrentUserInfo" {
  export default function getCurrentUserInfo(): Promise<any>;
}
