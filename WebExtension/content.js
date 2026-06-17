(function () {
    "use strict";

    if (window.location.hostname !== "jiggmin2.com") {
        return;
    }

    var EVENT_NOTIFY = "blueCall:jGrowlNotify";
    var EVENT_CLOSE = "blueCall:jGrowlClose";
    var QUICK_REPLY_ERROR_PREFIX = "There was an error posting your reply:";
    var WAIT_SECONDS_PATTERN = /Please wait\s+(\d+)\s+more\s+seconds?\./i;
    var POST_REPLY_CLICK_WINDOW = 30000;
    var SITE_JGROWL_DEFAULTS = {
        pool: 0,
        header: "",
        group: "",
        sticky: false,
        position: "top-right",
        appendTo: "body",
        glue: "after",
        theme: "default",
        themeState: "highlight",
        corners: "10px",
        check: 250,
        life: 3000,
        closeTemplate: "&times;"
    };
    var THEME_ALIASES = {
        default: "default",
        error: "jgrowl_error",
        fail: "jgrowl_error",
        failure: "jgrowl_error",
        success: "jgrowl_success",
        ok: "jgrowl_success"
    };

    function copyObject(source) {
        var copy = {};

        Object.keys(source || {}).forEach(function (key) {
            copy[key] = source[key];
        });

        return copy;
    }

    function normalizeOptions(typeOrOptions, options) {
        var normalized = copyObject(options);
        var type = typeOrOptions;

        if (type && typeof type === "object") {
            normalized = copyObject(type);
            type = normalized.type || normalized.kind || normalized.theme;
        }

        if (typeof type === "string") {
            normalized.theme = THEME_ALIASES[type] || type;
        }

        Object.keys(SITE_JGROWL_DEFAULTS).forEach(function (key) {
            if (typeof normalized[key] === "undefined") {
                normalized[key] = SITE_JGROWL_DEFAULTS[key];
            }
        });

        return normalized;
    }

    function getJGrowlContainer(options) {
        var container = document.getElementById("jGrowl");
        var appendTarget = document.querySelector(options.appendTo) || document.body || document.documentElement;

        if (!container) {
            container = document.createElement("div");
            container.id = "jGrowl";
            container.className = "jGrowl " + options.position;
            appendTarget.appendChild(container);
        }

        return container;
    }

    function closeNotification(notification) {
        if (!notification || !notification.parentNode) {
            return;
        }

        notification.parentNode.removeChild(notification);
    }

    function renderNotification(message, options) {
        var container = getJGrowlContainer(options);
        var notification = document.createElement("div");
        var closeButton = document.createElement("button");
        var header = document.createElement("div");
        var messageElement = document.createElement("div");
        var themeState = options.themeState ? " ui-state-" + options.themeState : "";
        var group = options.group ? " " + options.group : "";
        var paused = false;
        var createdAt = Date.now ? Date.now() : new Date().getTime();
        var closeTimer;

        notification.className = "jGrowl-notification alert" + themeState + " ui-corner-all" + group + " " + options.theme;
        notification.style.display = "block";

        closeButton.className = "jGrowl-close";
        closeButton.innerHTML = options.closeTemplate;
        closeButton.addEventListener("click", function () {
            closeNotification(notification);
        });

        header.className = "jGrowl-header";
        header.innerHTML = options.header || "";

        messageElement.className = "jGrowl-message";
        messageElement.innerHTML = message;

        notification.addEventListener("mouseover", function () {
            paused = true;
        });
        notification.addEventListener("mouseout", function () {
            paused = false;
        });

        notification.appendChild(closeButton);
        notification.appendChild(header);
        notification.appendChild(messageElement);

        if (options.glue === "before" && container.firstChild) {
            container.insertBefore(notification, container.firstChild);
        } else {
            container.appendChild(notification);
        }

        if (!options.sticky) {
            closeTimer = window.setInterval(function () {
                var currentTime = Date.now ? Date.now() : new Date().getTime();

                if (!paused && currentTime - createdAt >= parseInt(options.life, 10)) {
                    window.clearInterval(closeTimer);
                    closeNotification(notification);
                }
            }, parseInt(options.check, 10) || 250);
        }

        return notification;
    }

    function sendNotification(message, typeOrOptions, options) {
        var normalizedOptions = normalizeOptions(typeOrOptions, options);

        renderNotification(message, normalizedOptions);
        document.dispatchEvent(new CustomEvent(EVENT_NOTIFY, {
            detail: JSON.stringify({
                message: message,
                type: typeof typeOrOptions === "string" ? typeOrOptions : undefined,
                options: normalizedOptions
            })
        }));
    }

    function closeAll() {
        Array.prototype.forEach.call(document.querySelectorAll(".jGrowl-notification"), closeNotification);
        document.dispatchEvent(new CustomEvent(EVENT_CLOSE));
    }

    window.blueCall = sendNotification;
    window.blueCall.notify = sendNotification;
    window.blueCall.success = function (message, options) {
        sendNotification(message, "success", options);
    };
    window.blueCall.error = function (message, options) {
        sendNotification(message, "error", options);
    };
    window.blueCall.closeAll = closeAll;
    window.blueCall.defaults = SITE_JGROWL_DEFAULTS;
    window.blueCall.isReady = function () {
        return true;
    };

    var lastPostReplyClickAt = 0;
    var seenCooldownMessages = [];
    var quickReplyCooldownWatcherStarted = false;
    var postReplyClickListenerStarted = false;
    var activeCooldownTimer = null;
    var activeCountdownTimer = null;
    var cooldownEndsAt = 0;

    function now() {
        return Date.now ? Date.now() : new Date().getTime();
    }

    function rememberPostReplyClick(event) {
        var target = event.target;

        if (!target || !target.closest) {
            return;
        }

        if (target.closest("#quick_reply_submit") || target.closest("input[value='Post Reply'], button[value='Post Reply']")) {
            if (isCooldownActive()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                setPostReplyDisabled(true);
                return;
            }

            lastPostReplyClickAt = now();
        }
    }

    function getPostReplyButtons() {
        return document.querySelectorAll("#quick_reply_submit, input[value='Post Reply'], button[value='Post Reply']");
    }

    function setPostReplyDisabled(disabled) {
        Array.prototype.forEach.call(getPostReplyButtons(), function (button) {
            button.disabled = disabled;
        });
    }

    function isCooldownActive() {
        return activeCooldownTimer !== null && cooldownEndsAt > now();
    }

    function getRemainingCooldownSeconds() {
        return Math.max(0, Math.ceil((cooldownEndsAt - now()) / 1000));
    }

    function wasPostReplyClickedRecently() {
        return lastPostReplyClickAt > 0 && now() - lastPostReplyClickAt <= POST_REPLY_CLICK_WINDOW;
    }

    function normalizeText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function wasAlreadyHandled(key) {
        return seenCooldownMessages.indexOf(key) !== -1;
    }

    function markHandled(key) {
        seenCooldownMessages.push(key);

        if (seenCooldownMessages.length > 25) {
            seenCooldownMessages.shift();
        }
    }

    function scheduleCooldownNotification(seconds) {
        if (isCooldownActive()) {
            return false;
        }

        setPostReplyDisabled(true);
        cooldownEndsAt = now() + seconds * 1000;

        sendCountdownNotification();
        activeCountdownTimer = window.setInterval(sendCountdownNotification, 1000);
        activeCooldownTimer = window.setTimeout(function () {
            if (activeCountdownTimer) {
                window.clearInterval(activeCountdownTimer);
                activeCountdownTimer = null;
            }

            activeCooldownTimer = null;
            cooldownEndsAt = 0;
            sendNotification("You can try posting your reply again now.", "success", { life: 2000 });
            setPostReplyDisabled(false);
        }, seconds * 1000);

        return true;
    }

    function sendCountdownNotification() {
        var remainingSeconds = getRemainingCooldownSeconds();
        var secondLabel = remainingSeconds === 1 ? "second" : "seconds";

        if (remainingSeconds < 1) {
            return;
        }

        sendNotification("Please wait " + remainingSeconds + " more " + secondLabel + " before posting again.", "error", {
            life: 1000
        });
    }

    function inspectJGrowlNotification(notification) {
        var messageElement;
        var text;
        var match;
        var seconds;
        var messageKey;

        if (!notification || !notification.classList || !notification.classList.contains("jgrowl_error")) {
            return;
        }

        messageElement = notification.querySelector(".jGrowl-message");
        text = normalizeText(messageElement ? messageElement.textContent : notification.textContent);

        if (text.indexOf(QUICK_REPLY_ERROR_PREFIX) === -1) {
            return;
        }

        match = text.match(WAIT_SECONDS_PATTERN);
        if (!match) {
            return;
        }

        if (!wasPostReplyClickedRecently()) {
            return;
        }

        seconds = parseInt(match[1], 10);
        if (!seconds || seconds < 1) {
            return;
        }

        messageKey = text + "|" + lastPostReplyClickAt;
        if (wasAlreadyHandled(messageKey)) {
            return;
        }

        if (scheduleCooldownNotification(seconds)) {
            markHandled(messageKey);
        }
    }

    function inspectNodeForJGrowl(node) {
        if (!node || node.nodeType !== 1) {
            return;
        }

        if (isCooldownActive()) {
            setPostReplyDisabled(true);
        }

        if (node.matches && node.matches(".jGrowl-notification")) {
            inspectJGrowlNotification(node);
        }

        if (node.querySelectorAll) {
            Array.prototype.forEach.call(node.querySelectorAll(".jGrowl-notification"), inspectJGrowlNotification);
        }
    }

    function watchQuickReplyCooldown() {
        var observer;

        if (!postReplyClickListenerStarted) {
            postReplyClickListenerStarted = true;
            document.addEventListener("click", rememberPostReplyClick, true);
        }

        if (quickReplyCooldownWatcherStarted) {
            return;
        }

        if (!window.MutationObserver || !document.documentElement) {
            return;
        }

        quickReplyCooldownWatcherStarted = true;
        observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                Array.prototype.forEach.call(mutation.addedNodes, inspectNodeForJGrowl);
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        inspectNodeForJGrowl(document.documentElement);
    }

    watchQuickReplyCooldown();

    if (!document.documentElement) {
        document.addEventListener("DOMContentLoaded", watchQuickReplyCooldown, { once: true });
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function (request) {
            if (!request || request.type !== "blueCall.notify") {
                return undefined;
            }

            sendNotification(request.message, request.notificationType || request.theme, request.options);
            return undefined;
        });
    }
}());
