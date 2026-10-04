// ==UserScript==
// @name         WME EZ Comments
// @namespace    http://tampermonkey.net/
// @version      2.6.1
// @description  Customizable quick comments for Waze Map Editor with placeholder support
// @author       https://github.com/michaelrosstarr
// @homepageURL  https://wmekit.com/wme-ez-comment
// @supportURL   https://github.com/wmekit/WME-EZComments/issues
// @updateURL    https://raw.githubusercontent.com/wmekit/WME-EZComments/main/wme-ez-comments.user.js
// @downloadURL  https://raw.githubusercontent.com/wmekit/WME-EZComments/main/wme-ez-comments.user.js
// @match        https://www.waze.com/*/editor*
// @match        https://www.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @exclude      https://www.waze.com/user/editor*
// @exclude      https://beta.waze.com/user/editor*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=waze.com
// @require      https://sync.wazetools.com/wme-sync-lib.js
// @require      https://cdn.jsdelivr.net/gh/wmekit/wmekit-wme-ui@1.1.0/dist/wmekit-wme-ui.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      sync.wazetools.com
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'WME EZ Comments';
    // Read from the @version header so there's only one place to bump
    const SCRIPT_VERSION = GM_info.script.version;
    const SCRIPT_ID = 'wme-ez-comments-bushmanza-edition';
    const GITHUB_REPO = 'michaelrosstarr/WME-EZComments';
    const SCRIPT_FILE = 'wme-ez-comments.user.js';
    const STORAGE_KEY = 'wme_ez_comments_templates';
    const CUSTOM_USERNAME_KEY = 'wme_ez_comments_custom_username';
    const COMPACT_BUTTONS_KEY = 'wme_ez_comments_compact_buttons';
    const SYNC_ENABLED_KEY = 'wme_ez_comments_sync_enabled';
    const SYNC_KEY = 'settings';

    // Granting GM_* APIs runs the script in the userscript manager's sandbox, so
    // page globals like the WME SDK bootstrap have to be read from unsafeWindow.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // Variables
    let sdk = null;

    const DEFAULT_MESSAGE_TYPES = [
        {
            id: 'initial',
            label: 'Initial',
            text: `Hi, Waze volunteers responding to your "{TYPE}" issue that you reported on {FULLDATE}.

                  Can you please give us some additional information? Waze gives us very little to work off of so it would be greatly appreciated if you could help us out.

                  Please reply using the Waze app and not emails, the report system does not work with replying to the email.

                  ~ {USERNAME}

                  *Open to any editor*`
        },
        {
            id: 'followUp',
            label: 'Follow Up',
            text: `Hi, we haven't heard back from you about the "{TYPE}" issue you reported on {FULLDATE}.

                  Please help us to make Waze better for all users. Please respond using the Waze app, emails don't work with the reporting system.

                  ~ {USERNAME}

                  *Open to any editor*`
        },
        {
            id: 'final',
            label: 'Final Follow Up',
            text: `Hi, we haven't heard back from you about your "{TYPE}" issue that you reported on {FULLDATE}.

                  If we don't hear from you soon, we will assume that this is no longer an issue and close the report. Please reply using the Waze app and not emails, the report system does not work with replying to the email.

                  ~ {USERNAME}

                  *Open to any editor*`
        },
        {
            id: 'close',
            label: 'No Reply',
            text: `Hi, since we haven't heard back from you, we are going to close this issue. If you come across any other issues, please feel free to report it again via the Waze app.

                  ~ {USERNAME}`
        },
        {
            id: 'added',
            label: 'Added',
            text: `Added. Please allow up to 72 hours for it to show/update in your Waze app.

                Regards, {USERNAME}`
        }
    ];

    const PLACEHOLDERS = {
        '{TYPE}': 'Issue type/description',
        '{FULLDATE}': 'Full date (Month Day, Year)',
        '{MONTH}': 'Month name',
        '{SHORTMONTH}': 'Short month (Jan, Feb, etc.)',
        '{DAY}': 'Day of month',
        '{YEAR}': 'Year',
        '{WEEKDAY}': 'Full weekday name (Monday, Tuesday, etc.)',
        '{SHORTWEEKDAY}': 'Short weekday (Mon, Tue, etc.)',
        '{USERNAME}': 'Your Waze username',
        '{DATE}': 'Full date string'
    };

    const monthNames = {
        "Jan": "January",
        "Feb": "February",
        "Mar": "March",
        "Apr": "April",
        "May": "May",
        "Jun": "June",
        "Jul": "July",
        "Aug": "August",
        "Sep": "September",
        "Oct": "October",
        "Nov": "November",
        "Dec": "December"
    };

    const weekdayNames = {
        "Mon": "Monday",
        "Tue": "Tuesday",
        "Wed": "Wednesday",
        "Thu": "Thursday",
        "Fri": "Friday",
        "Sat": "Saturday",
        "Sun": "Sunday"
    };

    const dayOfWeekPattern = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;

    function generateTypeId() {
        return 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // Load message types from localStorage or use defaults.
    // Transparently migrates the old fixed-key object format ({initial: "...", ...})
    // to the new array-of-types format so existing users keep their saved text.
    function loadMessageTypes() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
                if (parsed && typeof parsed === 'object') {
                    return DEFAULT_MESSAGE_TYPES.map(defaultType => ({
                        ...defaultType,
                        text: typeof parsed[defaultType.id] === 'string' ? parsed[defaultType.id] : defaultType.text
                    }));
                }
            } catch (e) {
                console.error('Error loading message types:', e);
            }
        }
        return DEFAULT_MESSAGE_TYPES.map(type => ({ ...type }));
    }

    // Save message types to localStorage
    function saveMessageTypes(types) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
    }

    // Load custom username from localStorage
    function loadCustomUsername() {
        return localStorage.getItem(CUSTOM_USERNAME_KEY) || '';
    }

    // Save custom username to localStorage
    function saveCustomUsername(username) {
        localStorage.setItem(CUSTOM_USERNAME_KEY, username);
    }

    // Load compact buttons preference from localStorage
    function loadCompactButtons() {
        return localStorage.getItem(COMPACT_BUTTONS_KEY) === 'true';
    }

    // Save compact buttons preference to localStorage
    function saveCompactButtons(compact) {
        localStorage.setItem(COMPACT_BUTTONS_KEY, compact ? 'true' : 'false');
    }

    // Load cloud sync opt-in from localStorage. Kept per-browser, never synced.
    function loadSyncEnabled() {
        return localStorage.getItem(SYNC_ENABLED_KEY) === 'true';
    }

    // Save cloud sync opt-in to localStorage
    function saveSyncEnabled(enabled) {
        localStorage.setItem(SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
    }

    let messageTypes = loadMessageTypes();
    let customUsername = loadCustomUsername();
    let compactButtons = loadCompactButtons();

    // WMESync client, set only while cloud sync is enabled and signed in
    let sync = null;

    function getSettingsSnapshot() {
        return { messageTypes, customUsername, compactButtons };
    }

    // Apply settings pulled from the cloud and cache them in localStorage, which
    // stays the offline fallback.
    function applySettings(remote) {
        if (!remote || typeof remote !== 'object') return;

        if (Array.isArray(remote.messageTypes)) {
            messageTypes = remote.messageTypes;
            saveMessageTypes(messageTypes);
        }
        if (typeof remote.customUsername === 'string') {
            customUsername = remote.customUsername;
            saveCustomUsername(customUsername);
        }
        if (typeof remote.compactButtons === 'boolean') {
            compactButtons = remote.compactButtons;
            saveCompactButtons(compactButtons);
        }
    }

    // Sign in to WMESync (showing or asking for the PIN on first use) and pull
    // the remote settings. Remote wins on load; if nothing is stored yet, the
    // local settings seed it. With `pin`, that PIN is used instead of prompting
    // for one (signing in to an existing WME Sync account from the settings tab).
    async function startSync(pin) {
        const options = { scriptId: SCRIPT_ID, sdk };
        if (pin) {
            let pinUsed = false;
            options.promptForPin = (username) => {
                if (pinUsed) {
                    throw new Error(`That PIN didn't work for "${username}".`);
                }
                pinUsed = true;
                return pin;
            };
        }

        try {
            sync = await WMESync.init(options);
            if (pin) {
                // Drop any existing session so the entered PIN is the one used
                await sync.signOut();
            }
            const remote = await sync.get(SYNC_KEY);
            if (remote) {
                applySettings(remote);
            } else {
                await sync.set(SYNC_KEY, getSettingsSnapshot());
            }
        } catch (error) {
            sync = null;
            throw error;
        }
    }

    // Sign this browser out of WMESync: revokes its token and forgets the PIN, so
    // the next sign-in asks for a PIN again. Local settings are left as they are.
    async function signOutSync() {
        const client = sync ?? await WMESync.init({ scriptId: SCRIPT_ID, sdk });
        sync = null;
        await client.signOut();
    }

    // Push the current settings to the cloud. Last write wins.
    async function pushSettings() {
        if (sync) {
            await sync.set(SYNC_KEY, getSettingsSnapshot());
        }
    }

    // Replace placeholders in template
    function replacePlaceholders(template, type, dateStr) {



        let result = template;

        // Parse the date string to extract components
        // Handle formats like:
        // "Mon Jan 15 2026" (day of week, month, day, year)
        // "Jan 15, 2026" (month, day with comma, year)
        // "Mon, Jan 15, 2026" (day of week with comma, month, day with comma, year)

        // Remove commas for easier parsing
        const cleanDateStr = dateStr.replace(/,/g, '');
        const dateParts = cleanDateStr.split(' ').filter(part => part.trim() !== '');

        // Determine the format based on parts count and content
        let shortMonth = '';
        let day = '';
        let year = '';
        let shortWeekday = '';

        // Check if first part is a day of week (3 letters) or month (3 letters)
        // Day of week: Mon, Tue, Wed, Thu, Fri, Sat, Sun
        // Month: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec
        if (dateParts.length >= 3) {
            // Check if first part is a day of week
            if (dayOfWeekPattern.test(dateParts[0]) && dateParts.length >= 4) {
                // Format: "Mon Jan 15 2026" or "Mon, Jan 15, 2026"
                shortWeekday = dateParts[0] || '';
                shortMonth = dateParts[1] || '';
                day = dateParts[2] || '';
                year = dateParts[3] || '';
            } else if (!dayOfWeekPattern.test(dateParts[0]) && dateParts.length >= 3) {
                // Format: "Jan 15 2026" or "Jan 15, 2026"
                shortMonth = dateParts[0] || '';
                day = dateParts[1] || '';
                year = dateParts[2] || '';
            }

            // Day-before-month format: "Sat 12 Sep 2026" or "12 Sep 2026"
            if (!monthNames[shortMonth] && monthNames[day]) {
                [shortMonth, day] = [day, shortMonth];
            }
        }

        // Get username - use custom username if set, otherwise get from SDK
        let username = customUsername || 'Waze Volunteer';
        if (!customUsername) {
            try {
                const userInfo = sdk?.State?.getUserInfo();
                if (userInfo?.userName) {
                    username = userInfo.userName;
                }
            } catch (e) {
                console.error('Error getting username:', e);
            }
        }

        // Only build FULLDATE from parts if we have all required components
        // (a month abbreviation not in monthNames is used as-is)
        let fullDate;
        if (shortMonth && day && year) {
            fullDate = `${monthNames[shortMonth] || shortMonth} ${day}, ${year}`;
        } else {
            // Date parsing failed, use raw date string
            fullDate = dateStr;
        }

        const values = {
            '{TYPE}': type,
            '{FULLDATE}': fullDate,
            '{MONTH}': monthNames[shortMonth] || '',
            '{SHORTMONTH}': shortMonth || '',
            '{DAY}': day || '',
            '{YEAR}': year || '',
            '{WEEKDAY}': weekdayNames[shortWeekday] || '',
            '{SHORTWEEKDAY}': shortWeekday || '',
            '{USERNAME}': username,
            '{DATE}': dateStr
        };

        return result.replace(/\{[A-Z]+\}/g, m => values[m] ?? m);
    }

    function getCommentText(typeId, type, date) {
        const messageType = messageTypes.find(t => t.id === typeId);
        return replacePlaceholders(messageType ? messageType.text : '', type, date);
    }

    // Find the first match for any selector, looking inside the panel before the whole document
    function findInPanelOrDocument(selectors) {
        const panel = document.querySelector('.mapUpdateRequest');
        for (const root of panel ? [panel, document] : [document]) {
            for (const selector of selectors) {
                const element = root.querySelector(selector);
                if (element) return element;
            }
        }
        return null;
    }

    // Read the type and date of the issue currently shown. Called on click so it
    // always reflects the open issue, even when WME reuses the panel DOM.
    function extractIssueDetails() {
        const subTitleElement = findInPanelOrDocument([
            '.issue-panel-header .sub-title',
            'span[class*="subTitle--"]'
        ]);
        const subTitle = subTitleElement ? subTitleElement.textContent.trim() : 'No sub-title found';

        // Try multiple selectors to find the date
        const reportedDateElement = findInPanelOrDocument([
            '.issue-panel-header .reported',
            '.mapUpdateRequest .reported',
            '[class*="reported--"]',
            '[class*="reported"]'
        ]);

        let reportedDate = '';

        if (reportedDateElement) {
            const reportedText = reportedDateElement.textContent.trim();

            // Extract date and strip time if present
            // Format: "Submitted on: Thu Dec 04 2025, 18:55"
            const dateMatch = reportedText.match(/Submitted on[:\s]+(.+)/i) ||
                reportedText.match(/Reported on[:\s]+(.+)/i);

            if (dateMatch && dateMatch[1]) {
                // Remove time portion (anything after comma followed by time like ", 18:55")
                reportedDate = dateMatch[1].replace(/,\s*\d{2}:\d{2}.*$/, '').trim();
            } else {
                // Try to extract just the date portion directly
                const directDateMatch = reportedText.match(/(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{4})/);
                reportedDate = directDateMatch ? directDateMatch[1] : reportedText;
            }
        } else {
            reportedDate = 'No reported date found';
        }

        return [subTitle, reportedDate];
    }

    function insertButton(modal) {
        const commentList = modal.querySelector('.conversation-view .comment-list');
        const newCommentForm = modal.querySelector('.conversation-view .new-comment-form');

        if (!commentList || !newCommentForm) {
            return;
        }

        try {
            const createButton = (text, templateKey, marginBottom = '5px') => {
                const button = document.createElement('wz-button');
                button.setAttribute('type', 'button');
                button.setAttribute('size', compactButtons ? 'sm' : 'md');
                button.setAttribute('style', `margin-bottom: ${marginBottom}`);
                button.setAttribute('disabled', 'false');
                button.classList.add('send-button', 'ez-comment-button');
                button.textContent = text;

                button.addEventListener('mousedown', () => {
                    const wzTextarea = modal.querySelector('.new-comment-form wz-textarea');
                    if (wzTextarea) {
                        const [type, date] = extractIssueDetails();
                        wzTextarea.setAttribute('value', getCommentText(templateKey, type, date));
                        wzTextarea.dispatchEvent(new Event('input'));
                    }
                });

                return button;
            };

            const gap = compactButtons ? '3px' : '5px';
            const lastGap = compactButtons ? '20px' : '30px';
            const fragment = document.createDocumentFragment();
            messageTypes.forEach((messageType, index) => {
                const marginBottom = index === messageTypes.length - 1 ? lastGap : gap;
                fragment.appendChild(createButton(messageType.label, messageType.id, marginBottom));
            });
            commentList.parentNode.insertBefore(fragment, newCommentForm);

        } catch (error) {
            console.error('Error inserting buttons:', error);
        }
    }

    function ensureButtons(panel) {
        if (!panel.querySelector('.ez-comment-button')) {
            insertButton(panel);
        }
    }

    // Always look up the current panel: WME replaces the panel element when
    // switching between update requests, so a stale reference can't be reused
    function checkPanel() {
        const panel = document.querySelector('.mapUpdateRequest');
        if (panel) ensureButtons(panel);
    }

    function setupPanelDetection() {
        // Catches panel swaps and re-renders (e.g. switching to the conversation tab);
        // throttled to one check per animation frame
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                checkPanel();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Fast path for when a panel opens
        sdk.Events.on({
            eventName: 'wme-update-request-panel-opened',
            eventHandler: checkPanel
        });

        // A panel may already be open (e.g. a permalink to an update request)
        checkPanel();
    }

    // Returns a positive number if version a is newer than b
    function compareVersions(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    function gmGet(url, headers = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers,
                onload: (res) => res.status === 200
                    ? resolve(res.responseText)
                    : reject(new Error(`Unexpected response (HTTP ${res.status})`)),
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timed out')),
                timeout: 15000
            });
        });
    }

    // Find the latest published version. raw.githubusercontent.com/.../main/ is
    // cached for up to 5 minutes (query strings don't bypass it), so resolve the
    // current commit via the API and read the file pinned to that commit instead.
    async function fetchLatestRelease() {
        const sha = (await gmGet(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
            Accept: 'application/vnd.github.sha'
        })).trim();
        const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${sha}/${SCRIPT_FILE}`;
        const match = (await gmGet(url)).match(/^\/\/\s*@version\s+(\S+)/m);
        if (!match) throw new Error('No @version found in published script');
        return { version: match[1], url };
    }

    async function createSettingsTab() {
        const { createPane, header, card, toggle, button, textInput, textArea, field, pill, ICONS } = WMEKitUI;

        // Register the tab using SDK - call without parameters
        const { tabLabel, tabPane } = await sdk.Sidebar.registerScriptTab();

        // Set the tab label
        tabLabel.innerText = SCRIPT_NAME;
        tabLabel.title = 'Customize quick comment templates';

        const root = createPane(tabPane, { id: 'ezc-settings' });

        const div = (className, text) => {
            const node = document.createElement('div');
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const row = (...children) => {
            const node = div('kit-row');
            node.append(...children);
            return node;
        };

        // Working copy of message types edited in this tab. Nothing is persisted
        // until "Save All" is clicked.
        let draftTypes = messageTypes.map(t => ({ ...t }));

        // Header with update check
        const head = header({ title: SCRIPT_NAME, icon: ICONS.message, pills: ['v' + SCRIPT_VERSION] });
        const updateStatus = document.createElement('span');
        updateStatus.className = 'kit-status kit-muted';
        const updateBtn = button({ label: 'Check for update', variant: 'secondary', size: 'sm', onClick: checkForUpdate });
        const updateRow = row(updateBtn, updateStatus);
        updateRow.style.marginTop = '10px';
        head.el.insertBefore(updateRow, head.el.querySelector('.kit-notice'));

        // Settings
        const customUsernameInput = textInput({ placeholder: 'Leave blank to use your Waze username' });
        const compactToggle = toggle({
            label: 'Compact buttons',
            hint: 'Smaller message type buttons with tighter spacing in the reply panel.',
            checked: compactButtons
        });
        const compactButtonsInput = compactToggle.querySelector('input');

        // Cloud sync
        const syncToggle = toggle({
            label: 'Enable cloud sync',
            hint: "Syncs message types, username and compact setting across browsers via WME Sync. The first time you'll be shown a PIN for your Waze username - keep it to sign in elsewhere.",
            checked: !!sync
        });
        const syncEnabledInput = syncToggle.querySelector('input');
        const syncStatusEl = document.createElement('span');
        const syncLogoutBtn = button({
            label: 'Sign out',
            variant: 'danger',
            size: 'sm',
            title: 'Sign this browser out of WME Sync. You can sign in again with your PIN.',
            onClick: signOut
        });
        const syncStatusRow = row(div('kit-muted', 'Status:'), syncStatusEl, syncLogoutBtn);
        const syncPinInput = textInput({ type: 'password', inputMode: 'numeric', placeholder: 'WME Sync PIN' });
        syncPinInput.autocomplete = 'off';
        const syncLoginBtn = button({ label: 'Sign in & sync', onClick: signInWithPin });
        const syncLoginEl = field({
            label: 'Already synced in another browser?',
            hint: 'Enter the PIN for your Waze username to load your settings.',
            control: row(syncPinInput, syncLoginBtn)
        });

        // Message types. Placeholder pills insert into the last focused template.
        let lastFocusedTextarea = null;
        const placeholderPills = div('kit-pills');
        placeholderPills.style.margin = '8px 0 4px';
        Object.entries(PLACEHOLDERS).forEach(([token, description]) => {
            placeholderPills.appendChild(pill(token, { title: description, onClick: () => insertPlaceholder(token) }));
        });
        const typeListEl = div();

        // Preview
        const previewContainer = div();
        previewContainer.hidden = true;

        const statusEl = document.createElement('div');
        statusEl.hidden = true;

        root.append(
            head.el,
            card({
                title: 'Settings',
                children: [
                    field({
                        label: 'Custom username',
                        hint: 'Used instead of your Waze username for {USERNAME}.',
                        control: customUsernameInput
                    }),
                    compactToggle
                ]
            }),
            card({ title: 'Cloud sync', children: [syncToggle, syncStatusRow, syncLoginEl] }),
            card({
                title: 'Message types',
                children: [
                    div('kit-muted', 'Each type adds a button to the reply panel. Click a placeholder to insert it at the cursor.'),
                    placeholderPills,
                    typeListEl,
                    button({
                        label: '+ Add message type',
                        variant: 'secondary',
                        onClick: () => {
                            draftTypes.push({ id: generateTypeId(), label: 'New Message', text: '' });
                            renderTypeList();
                        }
                    })
                ]
            }),
            card({
                title: 'Preview',
                children: [
                    button({ label: 'Generate preview', variant: 'secondary', onClick: renderPreview }),
                    previewContainer
                ]
            }),
            row(
                button({ label: 'Save all', onClick: saveAll }),
                button({ label: 'Reset to defaults', variant: 'danger', onClick: resetToDefaults })
            ),
            statusEl
        );

        function renderTypeList() {
            lastFocusedTextarea = null;
            typeListEl.replaceChildren(...draftTypes.map((mt, index) => {
                const labelInput = textInput({
                    value: mt.label,
                    placeholder: 'Button label',
                    onInput: (value) => { draftTypes[index].label = value; }
                });
                const upBtn = button({
                    label: '↑',
                    variant: 'secondary',
                    size: 'sm',
                    title: 'Move up',
                    disabled: index === 0,
                    onClick: () => {
                        [draftTypes[index - 1], draftTypes[index]] = [draftTypes[index], draftTypes[index - 1]];
                        renderTypeList();
                    }
                });
                const downBtn = button({
                    label: '↓',
                    variant: 'secondary',
                    size: 'sm',
                    title: 'Move down',
                    disabled: index === draftTypes.length - 1,
                    onClick: () => {
                        [draftTypes[index + 1], draftTypes[index]] = [draftTypes[index], draftTypes[index + 1]];
                        renderTypeList();
                    }
                });
                const deleteBtn = button({
                    label: '×',
                    variant: 'danger',
                    size: 'sm',
                    title: 'Delete this message type',
                    onClick: () => {
                        draftTypes.splice(index, 1);
                        renderTypeList();
                    }
                });
                const textEl = textArea({
                    value: mt.text,
                    placeholder: 'Message text',
                    rows: 5,
                    monospace: true,
                    onInput: (value) => { draftTypes[index].text = value; }
                });
                textEl.addEventListener('focus', () => { lastFocusedTextarea = textEl; });

                const item = div('kit-field');
                item.append(row(labelInput, upBtn, downBtn, deleteBtn), textEl);
                return item;
            }));
        }

        function insertPlaceholder(token) {
            const target = lastFocusedTextarea?.isConnected ? lastFocusedTextarea : typeListEl.querySelector('textarea');
            if (!target) return;
            target.focus();
            target.setRangeText(token, target.selectionStart, target.selectionEnd, 'end');
            target.dispatchEvent(new Event('input'));
        }

        // Reset the form from the saved settings (e.g. after pulling from the cloud)
        function refreshForm() {
            draftTypes = messageTypes.map(t => ({ ...t }));
            renderTypeList();
            customUsernameInput.value = customUsername;
            compactButtonsInput.checked = compactButtons;
        }

        refreshForm();

        function setSyncUi(status) {
            syncEnabledInput.checked = !!sync;
            syncLoginEl.hidden = !!sync;
            syncLogoutBtn.hidden = !sync;
            syncStatusEl.textContent = status;
        }

        setSyncUi(sync ? 'Synced' : (loadSyncEnabled() ? 'Error - using local settings' : 'Off'));

        // Turn sync on, optionally with a PIN entered in the tab, and load the
        // synced settings into the form.
        async function enableSync(pin) {
            syncEnabledInput.disabled = true;
            syncLoginBtn.disabled = true;
            syncStatusEl.textContent = 'Connecting...';
            try {
                await startSync(pin);
                saveSyncEnabled(true);
                refreshForm();
                syncPinInput.value = '';
                setSyncUi('Synced');
                showStatus('Cloud sync enabled. Your synced settings have been loaded.', 'success');
            } catch (error) {
                console.error(`${SCRIPT_NAME}: Error enabling cloud sync:`, error);
                saveSyncEnabled(false);
                setSyncUi('Off');
                showStatus(`Could not enable cloud sync: ${error.message}`, 'error');
            } finally {
                syncEnabledInput.disabled = false;
                syncLoginBtn.disabled = false;
            }
        }

        syncEnabledInput.addEventListener('change', () => {
            if (syncEnabledInput.checked) {
                enableSync();
            } else {
                // The token is kept, so re-enabling later skips the PIN prompt.
                saveSyncEnabled(false);
                sync = null;
                setSyncUi('Off');
            }
        });

        async function signOut() {
            if (!confirm('Sign this browser out of WME Sync? Your settings stay saved here, and you can sign in again with your PIN.')) {
                return;
            }
            syncLogoutBtn.disabled = true;
            try {
                await signOutSync();
                showStatus('Signed out of cloud sync. Enter a PIN to sign in again.', 'success');
            } catch (error) {
                console.error(`${SCRIPT_NAME}: Error signing out of cloud sync:`, error);
                showStatus(`Sign out failed: ${error.message}`, 'error');
            } finally {
                saveSyncEnabled(false);
                setSyncUi('Off');
                syncLogoutBtn.disabled = false;
            }
        }

        function signInWithPin() {
            const pin = syncPinInput.value.trim();
            if (!/^\d{6,12}$/.test(pin)) {
                showStatus('Enter your WME Sync PIN (6-12 digits).', 'error');
                return;
            }
            enableSync(pin);
        }

        // Push to the cloud after a local save; the local save has already succeeded.
        async function pushAndReport(successMessage) {
            try {
                await pushSettings();
                if (sync) syncStatusEl.textContent = 'Synced';
                showStatus(successMessage, 'success');
            } catch (error) {
                console.error(`${SCRIPT_NAME}: Error pushing settings to cloud:`, error);
                syncStatusEl.textContent = `Error: ${error.message}`;
                showStatus(`Saved locally, but cloud sync failed: ${error.message}`, 'error');
            }
        }

        async function saveAll() {
            messageTypes = draftTypes.map(t => ({ ...t }));
            saveMessageTypes(messageTypes);

            customUsername = customUsernameInput.value.trim();
            saveCustomUsername(customUsername);

            compactButtons = compactButtonsInput.checked;
            saveCompactButtons(compactButtons);

            await pushAndReport('Message types and settings saved successfully!');
        }

        async function resetToDefaults() {
            if (confirm('Are you sure you want to reset all message types to defaults? This removes any custom message types you added.')) {
                messageTypes = DEFAULT_MESSAGE_TYPES.map(t => ({ ...t }));
                saveMessageTypes(messageTypes);
                draftTypes = messageTypes.map(t => ({ ...t }));
                renderTypeList();
                await pushAndReport('Message types reset to defaults!');
            }
        }

        async function checkForUpdate() {
            updateBtn.disabled = true;
            updateStatus.className = 'kit-status kit-muted';
            updateStatus.textContent = 'Checking...';
            head.setNotice(null);
            try {
                const { version: latest, url } = await fetchLatestRelease();
                if (compareVersions(latest, SCRIPT_VERSION) > 0) {
                    updateStatus.textContent = '';
                    const notice = document.createElement('span');
                    notice.append(`v${latest} is available - `);
                    const link = document.createElement('a');
                    link.href = url;
                    link.target = '_blank';
                    link.rel = 'noopener';
                    link.textContent = 'install update';
                    notice.append(link, ', then reload WME.');
                    head.setNotice(notice);
                } else {
                    updateStatus.className = 'kit-status kit-status-success';
                    updateStatus.textContent = `You're up to date (v${SCRIPT_VERSION}).`;
                }
            } catch (error) {
                console.error(`${SCRIPT_NAME}: update check failed`, error);
                updateStatus.className = 'kit-status kit-status-error';
                updateStatus.textContent = `Update check failed: ${error.message}`;
            } finally {
                updateBtn.disabled = false;
            }
        }

        function renderPreview() {
            const sampleType = 'Map Issue';
            const sampleDate = 'Mon Feb 10 2026';

            // Temporarily use the in-progress username for the preview
            const originalUsername = customUsername;
            customUsername = customUsernameInput.value.trim() || 'Waze Volunteer';

            previewContainer.replaceChildren(...draftTypes.map(mt => {
                const item = div('kit-field');
                const text = div('kit-textarea', replacePlaceholders(mt.text, sampleType, sampleDate));
                text.style.whiteSpace = 'pre-wrap';
                text.style.fontSize = '12px';
                item.append(div('kit-field-label', mt.label), text);
                return item;
            }));
            previewContainer.hidden = false;

            customUsername = originalUsername;
        }

        let statusTimer = null;
        function showStatus(message, type) {
            statusEl.textContent = message;
            statusEl.className = `kit-status kit-status-${type}`;
            statusEl.hidden = false;

            clearTimeout(statusTimer);
            statusTimer = setTimeout(() => {
                statusEl.hidden = true;
            }, 3000);
        }
    }

    // Initialize script with modern SDK
    async function init() {
        console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} initializing with WME SDK...`);

        try {
            // Get the SDK instance
            sdk = pageWindow.getWmeSdk({
                scriptId: SCRIPT_ID,
                scriptName: SCRIPT_NAME
            });

            console.log(`${SCRIPT_NAME}: SDK initialized`);

            // Wait for WME to be ready
            await sdk.Events.once({ eventName: 'wme-ready' });
            console.log(`${SCRIPT_NAME}: WME ready`);

            // Set up panel detection first so buttons don't wait on the network;
            // they read messageTypes at insert time
            setupPanelDetection();

            // Pull synced settings before building the settings tab so it uses them
            if (loadSyncEnabled()) {
                try {
                    await startSync();
                    console.log(`${SCRIPT_NAME}: Cloud sync loaded`);
                } catch (error) {
                    console.error(`${SCRIPT_NAME}: Cloud sync failed, using local settings:`, error);
                }
            }

            // Create settings tab
            await createSettingsTab();

            console.log(`${SCRIPT_NAME} initialized successfully!`);
        } catch (error) {
            console.error(`${SCRIPT_NAME}: Error during initialization:`, error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (pageWindow.SDK_INITIALIZED) {
                pageWindow.SDK_INITIALIZED.then(init);
            } else {
                console.error(`${SCRIPT_NAME}: SDK not available`);
            }
        });
    } else {
        if (pageWindow.SDK_INITIALIZED) {
            pageWindow.SDK_INITIALIZED.then(init);
        } else {
            console.error(`${SCRIPT_NAME}: SDK not available`);
        }
    }
})();
