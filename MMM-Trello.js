/* global Module */

/* Magic Mirror
 * Module: Trello
 *
 * By Joseph Bethge
 * MIT Licensed.
 */

Module.register("MMM-Trello", {

    // Default module config.
    defaults: {
        reloadInterval: 5 * 60 * 1000, // every 5 minutes
        updateInterval: 10 * 1000, // every 10 seconds
        animationSpeed: 2.5 * 1000, // 2.5 seconds
        showTitle: true,
        api_key: "",
        token: "",
        list: "",
        listTitle: "", // Optional title for the list
        showLineBreaks: false,
        showDueDate: true,
        showDescription: true,
        showChecklists: true,
        showChecklistTitle: false,
        wholeList: false,
        isCompleted: false,
        forceShowDescription: false,
        forceShowChecklists: false,
        autoScroll: false, // Enable auto-scrolling
        scrollSpeed: 0.5, // Scroll speed in pixels per second
        scrollPause: 5000, // Pause at top and bottom in milliseconds
        scrollStep: 1, // Pixels to scroll per step
        showUpdateIndicator: true, // Show a visual indicator when updates happen
        maxHeight: null, // Added for dynamic CSS
        filterByLabels: [], // Optional array of label names or colors to filter cards by
        showLabels: true // Whether to display labels on cards
    },

    // Define start sequence.
    start: function () {
        Log.info("Starting module: " + this.name);

        moment.locale(this.config.language);

        this.listContent = [];
        this.checklistData = {};

        this.activeItem = 0;

        this.loaded = false;
        this.error = false;
        this.errorMessage = "";
        this.retry = true;
        this.pause = false;
        
        // Store intervals for proper cleanup
        this.updateInterval = null;
        this.reloadInterval = null;
        this.scrollTimeout = null;

        // For wholeList mode, we don't need frequent DOM updates
        if (this.config.wholeList === true) {
            this.config.updateInterval = this.config.reloadInterval;
        }

        this.setTrelloConfig();

        this.requestUpdate();
        this.scheduleUpdateRequestInterval();

        this.scrollingActive = false;
        this.scrollContainerId = this.identifier + "-scroll-container";
        
        // Setup dynamic CSS
        this.setupDynamicStyles();
    },

    /* scheduleVisualUpdateInterval()
     * Schedule visual update.
     */
    scheduleVisualUpdateInterval: function () {
        var self = this;

        // Only do the initial animation if wholeList is false
        if (!this.config.wholeList) {
            self.updateDom(self.config.animationSpeed);
            
            // Clear existing interval if any
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
            }
            
            this.updateInterval = setInterval(function () {
                if (self.pause) {
                    return;
                }
                self.activeItem++;
                self.updateDom(self.config.animationSpeed);
            }, this.config.updateInterval);
        }
    },

    /* scheduleUpdateRequestInterval()
     * Schedule API update requests.
     */
    scheduleUpdateRequestInterval: function () {
        var self = this;
        
        // Immediate first update request
        this.requestUpdate();

        // Clear existing interval if any
        if (this.reloadInterval) {
            clearInterval(this.reloadInterval);
        }
        
        this.reloadInterval = setInterval(function () {
            if (self.pause) {
                return;
            }

            if (self.retry) {
                self.requestUpdate();
            }
        }, this.config.reloadInterval);
    },

    // Define required styles.
    getStyles: function () {
        return ["font-awesome.css", "MMM-Trello.css"];
    },

    // Define required scripts.
    getScripts: function () {
        return ["moment.js"];
    },

    // Override required translations.
    getTranslations: function () {
        return {
            en: "translations/en.json",
            de: "translations/de.json",
            sv: "translations/sv.json",
            pl: "translations/pl.json"
        };
    },

    // Override dom generator.
    getDom: function () {
        // For auto-scrolling with wholeList, we use a permanent container
        // to avoid rebuilding and interrupting the scroll animation
        if (this.config.autoScroll && this.config.wholeList && this.loaded && this.listContent.length > 0) {
            var dom = this.getScrollingDom();
            
            // If scrolling isn't active, start it now
            if (!this.scrollingActive && dom) {
                var self = this;
                setTimeout(function() {
                    self.startScrolling(dom);
                }, 200);
            }
            
            return dom;
        }
        
        // Regular DOM generation for all other cases
        var wrapper = document.createElement("div");
        wrapper.className = "MMM-Trello";

        if (this.activeItem >= this.listContent.length) {
            this.activeItem = 0;
        }

        if (this.loaded) {
            // Add list title at the top if available
            if (this.config.listTitle) {
                var listTitleContainer = document.createElement("div");
                listTitleContainer.className = "list-title-container";
                
                var listTitle = document.createElement("div");
                listTitle.className = "list-title bright";
                listTitle.textContent = this.config.listTitle;
                
                // Add update indicator if enabled
                if (this.config.showUpdateIndicator) {
                    this.updateIndicator = document.createElement("div");
                    this.updateIndicator.className = "update-indicator";
                    this.updateIndicator.style.display = "none";
                    listTitleContainer.appendChild(this.updateIndicator);
                }
                
                listTitleContainer.appendChild(listTitle);
                wrapper.appendChild(listTitleContainer);
            }
            
            if (this.listContent.length === 0) {
                var emptyMessage = document.createElement("div");
                emptyMessage.className = "small dimmed";
                emptyMessage.textContent = this.translate("NO_CARDS");
                wrapper.appendChild(emptyMessage);
            } else {
                var content, card, startat = 0, endat = this.listContent.length - 1;
                if (!this.config.wholeList) {
                    startat = this.activeItem;
                    endat = this.activeItem;
                }
                
                // Create a container for all cards
                var cardsContainer = document.createElement("div");
                cardsContainer.className = "cards-container";
                wrapper.appendChild(cardsContainer);
                
                // Render all cards
                this.renderCards(cardsContainer, startat, endat);
            }
        } else {
            if (this.error) {
                var errorElement = document.createElement("div");
                errorElement.className = "xsmall dimmed";
                errorElement.textContent = "Please check your config file, an error occured: " + this.errorMessage;
                wrapper.appendChild(errorElement);
            } else {
                var loadingWrapper = document.createElement("div");
                loadingWrapper.className = "loading-wrapper";
                
                var loadingIcon = document.createElement("span");
                loadingIcon.className = "loading-icon fa fa-refresh fa-spin fa-fw";
                loadingWrapper.appendChild(loadingIcon);
                
                wrapper.appendChild(loadingWrapper);
            }
        }

        return wrapper;
    },
    
    // Generate a separate DOM for scrolling that won't be affected by updates
    getScrollingDom: function() {
        var existingContainer = document.getElementById(this.scrollContainerId);
        
        // If we already have a scroll container, just update its data if needed
        if (existingContainer) {
            // Check if update indicator should be shown
            if (this.dataJustUpdated && this.config.showUpdateIndicator) {
                this.dataJustUpdated = false;
                var indicator = existingContainer.querySelector('.update-indicator');
                if (indicator) {
                    // Show indicator with CSS animation
                    indicator.style.display = "block";
                    
                    // Hide after the animation completes
                    setTimeout(function() {
                        indicator.style.display = "none";
                    }, 2000);
                }
            }
            
            return existingContainer;
        }
        
        // Create a new container for scrolling that won't be replaced
        var scrollContainer = document.createElement("div");
        scrollContainer.id = this.scrollContainerId;
        scrollContainer.className = "MMM-Trello";
        
        // Add list title at the top if available (outside of scrolling area)
        if (this.config.listTitle) {
            var listTitleContainer = document.createElement("div");
            listTitleContainer.className = "list-title-container fixed-title";
            
            var listTitle = document.createElement("div");
            listTitle.className = "list-title bright";
            listTitle.textContent = this.config.listTitle;
            
            // Add update indicator if enabled
            if (this.config.showUpdateIndicator) {
                var updateIndicator = document.createElement("div");
                updateIndicator.className = "update-indicator";
                updateIndicator.style.display = "none";
                listTitleContainer.appendChild(updateIndicator);
            }
            
            listTitleContainer.appendChild(listTitle);
            scrollContainer.appendChild(listTitleContainer);
        }
        
        // Create a container for all cards (this will be scrolled)
        var scrollWrapper = document.createElement("div");
        scrollWrapper.className = "scroll-wrapper";
        
        var cardsContainer = document.createElement("div");
        cardsContainer.className = "cards-container";
        scrollWrapper.appendChild(cardsContainer);
        
        // Add the scroll wrapper to the main container
        scrollContainer.appendChild(scrollWrapper);
        
        // Render all cards
        this.renderCards(cardsContainer, 0, this.listContent.length - 1);
        
        return scrollContainer;
    },
    
    // Add a helper function for safe HTML rendering
    sanitizeHTML: function(content) {
        if (!content) return '';
        
        // Create a temporary div element
        var temp = document.createElement('div');
        
        // Set the content as text - this automatically escapes HTML
        temp.textContent = content;
        
        // Return the safe HTML string
        return temp.innerHTML;
    },

    // Update renderCards to use the sanitize function
    renderCards: function(container, startIndex, endIndex) {
        for (var card = startIndex; card <= endIndex; card++) {
            // Create a container for each card
            var cardContainer = document.createElement("div");
            cardContainer.className = "card-container";
            container.appendChild(cardContainer);
            
            // Add labels if configured
            if (this.config.showLabels && this.listContent[card].labels && this.listContent[card].labels.length > 0) {
                var labelsContainer = document.createElement("div");
                labelsContainer.className = "card-labels";
                
                // Sort labels by color for consistent appearance
                var sortedLabels = this.listContent[card].labels.slice().sort(function(a, b) {
                    // If colors are the same, sort by name
                    if (a.color === b.color) {
                        return a.name.localeCompare(b.name);
                    }
                    // Sort by color
                    return (a.color || "").localeCompare(b.color || "");
                });
                
                // Add each label
                for (var l = 0; l < sortedLabels.length; l++) {
                    var label = sortedLabels[l];
                    var labelElement = document.createElement("span");
                    labelElement.className = "card-label";
                    
                    // Add color class if available
                    if (label.color) {
                        labelElement.className += " label-" + label.color;
                    } else {
                        labelElement.className += " label-none";
                    }
                    
                    // Add name if available
                    if (label.name) {
                        labelElement.textContent = this.sanitizeHTML(label.name);
                    }
                    
                    labelsContainer.appendChild(labelElement);
                }
                
                cardContainer.appendChild(labelsContainer);
            }
            
            if (this.config.showTitle || this.config.showDueDate) {
                var name = document.createElement("div");
                // Use CSS classes instead of directly applying styles
                var nameClasses = ["card-title"];
                
                if (this.config.isCompleted) {
                    nameClasses.push("is-completed");
                } else {
                    nameClasses.push("bright");
                }
                
                name.className = nameClasses.join(" ");

                content = "";
                if (this.config.showTitle) {
                    content = this.sanitizeHTML(this.listContent[card].name);
                }

                if (this.config.showDueDate && this.listContent[card].due) {
                    // Create a separate due date element controlled by CSS
                    var dueText = moment(this.listContent[card].due).fromNow();
                    
                    if (this.config.showTitle) {
                        var dueSpan = document.createElement("span");
                        dueSpan.className = "due-date";
                        dueSpan.textContent = dueText;
                        
                        name.innerHTML = content;
                        name.appendChild(document.createTextNode(" ("));
                        name.appendChild(dueSpan);
                        name.appendChild(document.createTextNode(")"));
                    } else {
                        name.className += " due-date-only";
                        name.textContent = dueText;
                    }
                } else {
                    name.innerHTML = content;
                }
                
                cardContainer.appendChild(name);
            }
            
            // Only show description if not using wholeList option or specifically required
            if(this.config.showDescription && (!this.config.wholeList || this.config.forceShowDescription)){
                var desc = document.createElement("div");
                desc.className = "card-description " + (this.config.isCompleted ? "is-completed dimmed" : "");

                content = this.sanitizeHTML(this.listContent[card].desc);

                if (this.config.showLineBreaks) {
                    var lines = content.split('\n');
                    for (var i in lines) {
                        var lineElement = document.createElement("div");
                        lineElement.className = "description-line";
                        lineElement.textContent = lines[i];
                        desc.appendChild(lineElement);
                    }
                }
                else {
                    desc.innerHTML = content;
                }
                cardContainer.appendChild(desc);
            }
            
            // Only show checklists if not using wholeList option or specifically required
            if (this.config.showChecklists && (!this.config.wholeList || this.config.forceShowChecklists)) {
                var checklistWrapper = document.createElement("div");
                checklistWrapper.className = "checklist-wrapper";
                this.getChecklistDom(checklistWrapper, card);
                cardContainer.appendChild(checklistWrapper);
            }
        }
    },

    /* getChecklistDom()
     * return the dom for all checklists on current card
     */
    getChecklistDom: function (wrapper, card) {
        var checklistIDs = this.listContent[card].idChecklists;
        if (!checklistIDs || checklistIDs.length === 0) {
            return;
        }
        
        for (var i = 0; i < checklistIDs.length; i++) {
            var checklistId = checklistIDs[i];
            if (checklistId in this.checklistData) {
                var checklist = this.checklistData[checklistId];
                if (!checklist.checkItems || checklist.checkItems.length === 0) {
                    continue;
                }
                
                // Sort checklist items by position
                checklist.checkItems.sort(function(a, b) {
                    return a.pos - b.pos;
                });
                
                if (this.config.showChecklistTitle) {
                    var titleElement = document.createElement("div");
                    titleElement.className = "checklist-title";
                    titleElement.textContent = this.sanitizeHTML(checklist.name);
                    wrapper.appendChild(titleElement);
                }

                for (var j = 0; j < checklist.checkItems.length; j++) {
                    var item = checklist.checkItems[j];
                    var itemWrapper = document.createElement("div");
                    itemWrapper.className = "checklist-item";

                    var itemSymbol = document.createElement("span");
                    itemSymbol.className = "checklist-item-icon " + 
                        (item.state === "complete" ? 
                         "checklist-item-complete" : "checklist-item-incomplete");
                    itemWrapper.appendChild(itemSymbol);

                    var itemName = document.createElement("span");
                    itemName.className = "checklist-item-name";
                    itemName.textContent = this.sanitizeHTML(item.name);
                    itemWrapper.appendChild(itemName);

                    wrapper.appendChild(itemWrapper);
                }
            } else {
                var loadingElement = document.createElement("div");
                loadingElement.className = "checklist-loading";
                
                var loadingIcon = document.createElement("span");
                loadingIcon.className = "loading-icon fa fa-refresh fa-spin fa-fw";
                loadingElement.appendChild(loadingIcon);
                
                wrapper.appendChild(loadingElement);
            }
        }
    },

    /* setTrelloConfig()
     * intializes trello backend
     */
    setTrelloConfig: function () {
        this.sendSocketNotification("TRELLO_CONFIG", {
            id: this.identifier,
            api_key: this.config.api_key,
            token: this.config.token
        });
    },

    /* requestUpdate()
     * request a list content update
     */
    requestUpdate: function () {
        this.sendSocketNotification("REQUEST_LIST_CONTENT", {list: this.config.list, id: this.identifier});
    },

    notificationReceived: function (notification, payload, sender) {
        if (notification === "USER_PRESENCE") {
            if (payload === true) {
                return !payload;
            }
            return true;
        }
    },

    // Override socket notification handler.
    socketNotificationReceived: function (notification, payload) {
        if (payload.id !== this.identifier) {
            // not for this module
            return;
        }

        if (notification === "TRELLO_ERROR") {
            // Build a more user-friendly error message
            var errorCode = payload.error.statusCode || "Unknown";
            var errorMsg = payload.error.statusMessage || "Unknown error";
            var details = payload.error.responseBody || "";
            
            this.errorMessage = "Error " + errorCode + " (" + errorMsg + ")" + 
                (details ? ": " + details : "");
            
            Log.error("MMM-Trello: " + this.errorMessage);

            this.error = true;
            // Only disable retry for permanent errors, not connection issues
            this.retry = (errorCode < 400 || errorCode >= 500);

            this.updateDom(0); // Use 0 to avoid animation
            return;
        }
        if (notification === "LIST_CONTENT") {
            this.error = false;
            
            // Store the new data
            var data = payload.data;
            
            // Filter by labels if configured
            if (this.config.filterByLabels && this.config.filterByLabels.length > 0) {
                data = this.filterCardsByLabels(data);
            }
            
            this.listContent = data;
            
            if (!this.loaded) {
                // First time loading - no animation
                this.loaded = true;
                
                // Initialize the display
                this.scheduleVisualUpdateInterval();
                
                // First update without animation
                this.updateDom(0);
                
                // Start scrolling immediately
                if (this.config.autoScroll && this.config.wholeList) {
                    // Start scrolling after a short moment to let DOM render
                    var self = this;
                    setTimeout(function() {
                        var container = document.getElementById(self.scrollContainerId);
                        if (container) {
                            self.startScrolling(container);
                        }
                    }, 200);
                }
            } else {
                if (this.config.autoScroll && this.config.wholeList) {
                    // ALWAYS show the update indicator when data is loaded from API
                    this.dataJustUpdated = true;
                    
                    // Always update cards
                    this.updateScrollingCards();
                } else {
                    // Standard update without animation for other modes
                    this.updateDom(0); // No animation
                }
            }
        }
        if (notification === "CHECK_LIST_CONTENT") {
            this.checklistData[payload.data.id] = payload.data;
        }
    },
    
    // Start auto-scrolling
    startScrolling: function(container) {
        if (!this.config.autoScroll || !this.config.wholeList || this.scrollingActive) {
            return;
        }
        
        // Find the scroll wrapper within the container
        var scrollWrapper = container.querySelector('.scroll-wrapper');
        if (!scrollWrapper) return;
        
        // Calculate and set the proper height for the scroll wrapper
        this.adjustScrollWrapperHeight(container, scrollWrapper);
        
        this.scrollingActive = true;
        this.scrollTarget = scrollWrapper;
        this.scrollPosition = 0;
        this.scrollDirection = 1;
        this.scrollPaused = false;
        
        this.performScroll();
    },
    
    // Adjust the height of the scroll wrapper based on container height and title height
    adjustScrollWrapperHeight: function(container, scrollWrapper) {
        if (!container || !scrollWrapper) return;
        
        // Get the title container if it exists
        var titleContainer = container.querySelector('.list-title-container');
        var titleHeight = titleContainer ? titleContainer.offsetHeight : 0;
        
        // Calculate available height (container height minus title height minus padding)
        var containerHeight = parseInt(window.getComputedStyle(container).maxHeight, 10) || 400;
        var availableHeight = containerHeight - titleHeight - 20; // 20px for padding
        
        // Set scroll wrapper height
        scrollWrapper.style.maxHeight = availableHeight + 'px';
    },

    // Add debounce helper function for performance
    debounce: function(func, wait) {
        var timeout;
        return function() {
            var context = this, args = arguments;
            var later = function() {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Perform scrolling animation
    performScroll: function() {
        if (!this.scrollTarget || !this.scrollingActive) {
            return;
        }
        
        // Clear any existing timeout
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
        
        // If paused, wait and then resume
        if (this.scrollPaused) {
            var self = this;
            this.scrollTimeout = setTimeout(function() {
                self.scrollPaused = false;
                self.performScroll();
            }, this.config.scrollPause);
            return;
        }
        
        // Calculate max scroll distance
        var maxScroll = this.scrollTarget.scrollHeight - this.scrollTarget.clientHeight;
        
        // Update scroll position
        this.scrollPosition += (this.config.scrollStep * this.scrollDirection);
        
        // Check boundaries
        if (this.scrollPosition <= 0) {
            this.scrollPosition = 0;
            this.scrollPaused = true;
            this.scrollDirection = 1;
        } else if (this.scrollPosition >= maxScroll) {
            this.scrollPosition = maxScroll;
            this.scrollPaused = true;
            this.scrollDirection = -1;
        }
        
        // Apply scroll (do this more efficiently)
        this.scrollTarget.scrollTop = this.scrollPosition;
        
        // Schedule next scroll with better performance
        var self = this;
        var delay = 1000 / (this.config.scrollSpeed * 2); // Convert speed to delay
        this.scrollTimeout = setTimeout(function() {
            self.performScroll();
        }, delay);
    },
    
    // Suspend scrolling when module is hidden
    suspend: function() {
        this.pause = true;
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
    },
    
    // Resume scrolling when module becomes visible
    resume: function() {
        this.pause = false;
        if (this.scrollingActive) {
            this.performScroll();
        }
    },

    // Update cards in the existing scrolling container
    updateScrollingCards: function() {
        var scrollContainer = document.getElementById(this.scrollContainerId);
        if (!scrollContainer) return;
        
        var cardsContainer = scrollContainer.querySelector('.cards-container');
        if (!cardsContainer) return;
        
        var scrollWrapper = scrollContainer.querySelector('.scroll-wrapper');
        if (!scrollWrapper) return;
        
        // Save the current scroll position if scrolling is active
        var currentScrollTop = 0;
        if (scrollWrapper && this.scrollingActive) {
            currentScrollTop = scrollWrapper.scrollTop;
        }
        
        // Clear existing cards
        cardsContainer.innerHTML = '';
        
        // Render new cards
        this.renderCards(cardsContainer, 0, this.listContent.length - 1);
        
        // Re-adjust the scroll wrapper height
        this.adjustScrollWrapperHeight(scrollContainer, scrollWrapper);
        
        // Restore scroll position if we were scrolling
        if (scrollWrapper && this.scrollingActive && !this.scrollPaused) {
            scrollWrapper.scrollTop = currentScrollTop;
            this.scrollPosition = currentScrollTop;
        }
        
        // ALWAYS show update indicator when this method is called
        var indicator = scrollContainer.querySelector('.update-indicator');
        if (indicator && this.config.showUpdateIndicator) {
            // Make sure it's hidden first so animation restarts
            indicator.style.display = "none";
            
            // Force browser to process the display change
            void indicator.offsetWidth;
            
            // Show with animation
            indicator.style.display = "block";
            
            // Hide after the animation completes
            setTimeout(function() {
                indicator.style.display = "none";
            }, 2000);
        }
        
        // Reset the flag - not actually needed but keep for consistency
        this.dataJustUpdated = false;
    },

    // Add dynamic CSS styles to the document
    setupDynamicStyles: function() {
        var moduleId = "#" + this.scrollContainerId;
        var styleId = this.identifier + "-dynamic-styles";
        
        // Check if style element already exists
        var styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        
        // Add dynamic styles based on config
        var css = '';
        
        // Set max-height directly
        if (this.config.maxHeight) {
            css += moduleId + " { max-height: " + this.config.maxHeight + "px; }\n";
            css += moduleId + " .scroll-wrapper { max-height: calc(" + this.config.maxHeight + "px - 60px); }\n";
        }
        
        // Apply CSS
        styleEl.innerHTML = css;
    },

    // Filter cards by labels
    filterCardsByLabels: function(cards) {
        if (!this.config.filterByLabels || this.config.filterByLabels.length === 0) {
            return cards;
        }
        
        var filteredCards = [];
        var labelFilters = this.config.filterByLabels.map(function(l) { 
            return l.toLowerCase(); 
        });
        
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var cardLabels = card.labels || [];
            
            // Check if card has any of the specified labels
            var hasMatchingLabel = cardLabels.some(function(label) {
                return labelFilters.includes(label.name.toLowerCase()) || 
                       labelFilters.includes(label.color) || 
                       // Support for full 6-digit hex color codes
                       (label.color === null && labelFilters.includes('none'));
            });
            
            if (hasMatchingLabel) {
                filteredCards.push(card);
            }
        }
        
        return filteredCards;
    },

    // Add proper cleanup for module to prevent memory leaks
    stop: function() {
        // Clear all intervals
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        if (this.reloadInterval) {
            clearInterval(this.reloadInterval);
            this.reloadInterval = null;
        }
        
        // Stop scrolling and clear timeout
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
        
        this.scrollingActive = false;
        Log.info("Stopping module: " + this.name);
    }
});

