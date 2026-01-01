import { LightningElement, api, wire, track } from 'lwc';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import publishPresence from '@salesforce/apex/CasePresencePublisher.publishPresence';
import getSettings from '@salesforce/apex/CasePresencePublisher.getSettings';
import getCurrentUserInfo from '@salesforce/apex/CasePresencePublisher.getCurrentUserInfo';
import getRecentDrafts from '@salesforce/apex/CasePresenceDraftHandler.getRecentDrafts';

const CHANNEL_NAME = '/event/Case_Presence__e';

export default class CasePresenceIndicator extends LightningElement {
    @api recordId; // Case ID
    @track presenceMap = new Map(); // Map of userId+sessionId -> presence data
    @track visibleUsers = []; // Array of users to display
    
    sessionId = this.generateSessionId();
    currentUserId;
    currentUserName;
    settings;
    heartbeatInterval;
    draftCheckInterval;
    visibilityCheckInterval;
    isActive = true;
    isEditing = false;
    subscription = null;
    isComponentActive = true;
    editModeCheckInterval;
    
    // Event listener references for cleanup
    visibilityChangeHandler;
    focusHandler;
    blurHandler;
    beforeUnloadHandler;
    
    // For mobile detection
    isMobile = false;
    
    connectedCallback() {
        this.detectMobile();
        this.initializeComponent();
        this.setupVisibilityTracking();
        this.setupEditModeDetection();
        this.setupBeforeUnload();
    }
    
    disconnectedCallback() {
        // Send final heartbeat to notify others we're leaving
        // This is async and will complete if navigation allows it
        this.sendGoodbyeHeartbeat();
        this.cleanup();
    }
    
    sendGoodbyeHeartbeat() {
        // Best effort goodbye notification
        // During beforeunload, this may not complete
        // The 10-minute timeout will clean up as fallback
        publishPresence({
            caseId: this.recordId,
            sessionId: this.sessionId,
            state: 'gone',
            isActive: false
        }).catch(error => {
            // Silently fail - cleanup timeout will handle it
            console.debug('Goodbye heartbeat failed (expected during unload)');
        });
    }
    
    detectMobile() {
        // Simple mobile detection
        this.isMobile = window.innerWidth < 768 || 
                       /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    
    async initializeComponent() {
        try {
            // Get settings
            this.settings = await getSettings();
            
            // Get current user info
            const userInfo = await getCurrentUserInfo();
            this.currentUserId = userInfo.userId;
            this.currentUserName = userInfo.userName;
            
            // Subscribe to Platform Events
            await this.subscribeToPlatformEvents();
            
            // Start heartbeat
            this.startHeartbeat();
            
            // Start draft checking
            this.startDraftCheck();
            
            // Start presence cleanup
            this.startPresenceCleanup();
            
            // Send initial heartbeat
            this.sendHeartbeat();
            
        } catch (error) {
            console.error('Error initializing component:', error);
        }
    }
    
    generateSessionId() {
        return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    async subscribeToPlatformEvents() {
        const messageCallback = (response) => {
            this.handlePresenceEvent(response.data.payload);
        };
        
        try {
            const response = await subscribe(CHANNEL_NAME, -1, messageCallback);
            this.subscription = response;
            console.log('Subscribed to Case_Presence__e');
        } catch (error) {
            console.error('Error subscribing to platform events:', error);
        }
        
        // Register error listener
        onError(error => {
            console.error('Platform Event error:', error);
        });
    }
    
    handlePresenceEvent(payload) {
        if (!payload || payload.CaseId__c !== this.recordId) {
            return;
        }
        
        const userId = payload.UserId__c;
        const sessionId = payload.SessionId__c;
        const key = `${userId}-${sessionId}`;
        
        // Ignore events from current session
        if (sessionId === this.sessionId) {
            return;
        }
        
        // Handle "gone" state - user is leaving
        if (payload.State__c === 'gone') {
            const existingPresence = this.presenceMap.get(key);
            if (existingPresence) {
                // Show toast notification
                this.showGoneToast(userId, existingPresence.userName);
                // Remove from presence map immediately
                this.presenceMap.delete(key);
                this.updateVisibleUsers();
            }
            return;
        }
        
        const existingPresence = this.presenceMap.get(key);
        const isNewUser = !existingPresence;
        const wasEditing = existingPresence?.isEditing;
        
        // Get or preserve user data
        let userName = existingPresence?.userName;
        let userPhotoUrl = existingPresence?.userPhotoUrl;
        
        // If new user, we need to fetch their info (will be available on next update)
        // For now, use the userId as fallback
        if (!userName) {
            userName = `User ${userId.substring(0, 8)}`;
        }
        
        // Update presence map
        this.presenceMap.set(key, {
            userId: userId,
            sessionId: sessionId,
            userName: userName,
            userPhotoUrl: userPhotoUrl,
            state: payload.State__c,
            isActive: payload.IsActive__c,
            timestamp: new Date(payload.Timestamp__c),
            isEditing: payload.State__c === 'editing' || payload.State__c === 'drafting'
        });
        
        // Show toast notifications
        this.showPresenceToast(userId, payload.State__c, isNewUser, wasEditing, userName);
        
        // Update visible users
        this.updateVisibleUsers();
    }
    
    showPresenceToast(userId, state, isNewUser, wasEditing, userName) {
        // Don't show toasts for current user
        if (userId === this.currentUserId) {
            return;
        }
        
        let message = '';
        
        // Check individual toast settings
        if (isNewUser && this.settings.showJoinToasts) {
            message = `${userName} is now viewing this case`;
        } else if (state === 'editing' && !wasEditing && this.settings.showEditStartToasts) {
            message = `${userName} started editing`;
        } else if (state === 'viewing' && wasEditing && this.settings.showEditStopToasts) {
            message = `${userName} stopped editing`;
        }
        
        if (message) {
            this.showCustomToast(message);
        }
    }
    
    showGoneToast(userId, userName) {
        // Don't show toasts for current user
        if (userId === this.currentUserId) {
            return;
        }
        
        // Check if leave toasts are enabled
        if (!this.settings.showLeaveToasts) {
            return;
        }
        
        const message = `${userName || 'Someone'} is no longer viewing this case`;
        this.showCustomToast(message);
    }
    
    showCustomToast(message) {
        // Always use pester mode for consistent 3-second auto-dismiss
        const event = new ShowToastEvent({
            message: message,
            variant: 'info',
            mode: 'pester'
        });
        this.dispatchEvent(event);
    }
    
    startHeartbeat() {
        const frequencyMs = this.settings.heartbeatFrequencySeconds * 1000;
        this.heartbeatInterval = setInterval(() => {
            if (this.isComponentActive) {
                this.sendHeartbeat();
            }
        }, frequencyMs);
    }
    
    async sendHeartbeat() {
        try {
            const state = this.isEditing ? 'editing' : 'viewing';
            await publishPresence({
                caseId: this.recordId,
                sessionId: this.sessionId,
                state: state,
                isActive: this.isActive
            });
        } catch (error) {
            console.error('Error sending heartbeat:', error);
        }
    }
    
    startDraftCheck() {
        this.draftCheckInterval = setInterval(async () => {
            await this.checkForDrafts();
        }, 10000); // Check every 10 seconds
    }
    
    async checkForDrafts() {
        try {
            const drafts = await getRecentDrafts({ caseId: this.recordId });
            
            // Update presence map with draft info
            for (const draft of drafts) {
                // Find all sessions for this user and update with user data
                for (let [key, presence] of this.presenceMap) {
                    if (presence.userId === draft.userId) {
                        presence.isEditing = true;
                        presence.isDrafting = true;
                        // Update user data if not already set
                        if (!presence.userName) {
                            presence.userName = draft.userName;
                            presence.userPhotoUrl = draft.userPhotoUrl;
                        }
                        this.presenceMap.set(key, presence);
                    }
                }
            }
            
            this.updateVisibleUsers();
        } catch (error) {
            console.error('Error checking drafts:', error);
        }
    }
    
    startPresenceCleanup() {
        this.visibilityCheckInterval = setInterval(() => {
            this.cleanupStalePresence();
        }, 60000); // Check every minute
    }
    
    cleanupStalePresence() {
        const expirationMs = this.settings.presenceExpirationMinutes * 60 * 1000;
        const cutoffTime = new Date(Date.now() - expirationMs);
        
        let hasChanges = false;
        const removedUsers = new Map(); // Track unique users being removed
        
        for (let [key, presence] of this.presenceMap) {
            if (presence.timestamp < cutoffTime) {
                // Track this user for toast notification
                if (!removedUsers.has(presence.userId)) {
                    removedUsers.set(presence.userId, presence.userName);
                }
                this.presenceMap.delete(key);
                hasChanges = true;
            }
        }
        
        // Show toast for each unique user that timed out
        for (let [userId, userName] of removedUsers) {
            this.showGoneToast(userId, userName);
        }
        
        if (hasChanges) {
            this.updateVisibleUsers();
        }
    }
    
    updateVisibleUsers() {
        // Convert map to array and merge by userId
        const userMap = new Map();
        
        for (let [key, presence] of this.presenceMap) {
            // Skip current user
            if (presence.userId === this.currentUserId) {
                continue;
            }
            
            const existingUser = userMap.get(presence.userId);
            
            if (!existingUser) {
                // Add new user
                const user = {
                    userId: presence.userId,
                    userName: presence.userName,
                    userPhotoUrl: presence.userPhotoUrl,
                    isActive: presence.isActive,
                    isEditing: presence.isEditing,
                    timestamp: presence.timestamp
                };
                // Add computed properties
                user.style = this.getUserStyle(user);
                user.timeAgo = this.getTimeAgo(user);
                userMap.set(presence.userId, user);
            } else {
                // Merge states - if ANY session is active, mark as active
                // If ANY session is editing, mark as editing
                existingUser.isActive = existingUser.isActive || presence.isActive;
                existingUser.isEditing = existingUser.isEditing || presence.isEditing;
                existingUser.timestamp = new Date(Math.max(
                    existingUser.timestamp.getTime(),
                    presence.timestamp.getTime()
                ));
                // Update computed properties
                existingUser.style = this.getUserStyle(existingUser);
                existingUser.timeAgo = this.getTimeAgo(existingUser);
                userMap.set(presence.userId, existingUser);
            }
        }
        
        // Convert to array and sort
        let users = Array.from(userMap.values());
        
        // Sort: editing first, then by timestamp
        users.sort((a, b) => {
            if (a.isEditing && !b.isEditing) return -1;
            if (!a.isEditing && b.isEditing) return 1;
            return b.timestamp - a.timestamp;
        });
        
        this.visibleUsers = users;
    }
    
    setupVisibilityTracking() {
        // Track when tab becomes active/inactive
        this.visibilityChangeHandler = () => {
            this.isActive = !document.hidden;
            if (this.isActive) {
                this.sendHeartbeat();
            }
        };
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
        
        // Track focus/blur
        this.focusHandler = () => {
            this.isActive = true;
            this.sendHeartbeat();
        };
        window.addEventListener('focus', this.focusHandler);
        
        this.blurHandler = () => {
            this.isActive = false;
            this.sendHeartbeat();
        };
        window.addEventListener('blur', this.blurHandler);
    }
    
    setupEditModeDetection() {
        // Check for edit mode every 2 seconds
        this.editModeCheckInterval = setInterval(() => {
            this.checkEditMode();
        }, 2000);
        
        // Initial check
        this.checkEditMode();
    }
    
    checkEditMode() {
        // Look for edit form in the DOM
        // Lightning record forms have these selectors when in edit mode
        const editForm = document.querySelector(
            'force-record-edit-form, ' +
            'lightning-record-edit-form, ' +
            'lightning-record-form[mode="edit"], ' +
            '.forceRecordLayout.uiInput'
        );
        
        const newEditState = !!editForm;
        
        // Only send heartbeat if state changed
        if (newEditState !== this.isEditing) {
            this.isEditing = newEditState;
            console.log(`Edit mode changed to: ${this.isEditing}`);
            this.sendHeartbeat(); // Immediately publish new state
        }
    }
    
    setupBeforeUnload() {
        // Clean up on page unload
        this.beforeUnloadHandler = () => {
            // Send goodbye notification before cleanup
            this.sendGoodbyeHeartbeat();
            this.cleanup();
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
    
    cleanup() {
        this.isComponentActive = false;
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        if (this.draftCheckInterval) {
            clearInterval(this.draftCheckInterval);
        }
        
        if (this.visibilityCheckInterval) {
            clearInterval(this.visibilityCheckInterval);
        }
        
        if (this.editModeCheckInterval) {
            clearInterval(this.editModeCheckInterval);
        }
        
        if (this.subscription) {
            unsubscribe(this.subscription);
        }
        
        // Remove event listeners to prevent memory leaks
        if (this.visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        }
        if (this.focusHandler) {
            window.removeEventListener('focus', this.focusHandler);
        }
        if (this.blurHandler) {
            window.removeEventListener('blur', this.blurHandler);
        }
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
    }
    
    // Getters for template
    get hasVisibleUsers() {
        return this.visibleUsers.length > 0;
    }
    
    get displayedUsers() {
        return this.isMobile ? this.visibleUsers : this.visibleUsers.slice(0, 5);
    }
    
    get additionalCount() {
        return this.visibleUsers.length > 5 ? this.visibleUsers.length - 5 : 0;
    }
    
    get showAdditionalCount() {
        return !this.isMobile && this.additionalCount > 0;
    }
    
    get mobileUserList() {
        return this.visibleUsers.map(user => {
            let name = user.userName || 'Unknown';
            if (user.isEditing) {
                name += ' (editing)';
            } else if (!user.isActive) {
                name += ' (idle)';
            }
            return name;
        }).join(', ');
    }
    
    // Helper methods for template
    getUserOpacity(user) {
        return user.isActive ? '1' : '0.5';
    }
    
    getUserBorder(user) {
        return user.isEditing ? '2px solid #0176d3' : 'none';
    }
    
    getUserStyle(user) {
        const opacity = user.isActive ? '1' : '0.5';
        const border = user.isEditing ? '2px solid #0176d3' : 'none';
        return `opacity: ${opacity}; border: ${border}; border-radius: 50%;`;
    }
    
    getTimeAgo(user) {
        const now = new Date();
        const diff = now - user.timestamp;
        const minutes = Math.floor(diff / 60000);
        
        if (minutes < 1) {
            return 'Active now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else {
            const hours = Math.floor(minutes / 60);
            return `${hours}h ago`;
        }
    }
    
    getUserTextColor(user) {
        if (user.isEditing) {
            return 'color: #0176d3; font-weight: bold;';
        } else if (!user.isActive) {
            return 'color: #747474;';
        }
        return 'color: #181818;';
    }
    
    handleAvatarHover(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        if (tooltip) {
            tooltip.style.display = 'block';
        }
    }
    
    handleAvatarLeave(event) {
        const userId = event.currentTarget.dataset.userid;
        const tooltip = this.template.querySelector(`.custom-tooltip[data-userid="${userId}"]`);
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }
}
