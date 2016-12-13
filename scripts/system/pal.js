"use strict";
/*jslint vars: true, plusplus: true, forin: true*/
/*globals Script, AvatarList, Camera, Overlays, OverlayWindow, Toolbars, Vec3, Quat, Controller, print */
//
// pal.js
//
// Created by Howard Stearns on December 9, 2016
// Copyright 2016 High Fidelity, Inc
//
// Distributed under the Apache License, Version 2.0
// See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//

// FIXME when we make this a defaultScript: (function() { // BEGIN LOCAL_SCOPE

Script.include("/~/system/libraries/controllers.js");

// Overlays
var overlays = {}; // Keeps track of all our extended overlay data objects, keyed by target identifier.
function ExtendedOverlay(key, type, properties) { // A wrapper around overlays to store the key it is associated with.
    overlays[key] = this;
    this.key = key;
    this.selected = false; // not undefined
    this.activeOverlay = Overlays.addOverlay(type, properties); // We could use different overlays for (un)selected...
}
// Instance methods:
ExtendedOverlay.prototype.deleteOverlay = function () { // remove display and data of this overlay
    Overlays.deleteOverlay(this.activeOverlay);
    delete overlays[this.key];
};

ExtendedOverlay.prototype.editOverlay = function (properties) { // change display of this overlay
    Overlays.editOverlay(this.activeOverlay, properties);
};
var UNSELECTED_COLOR = {red: 20, green: 250, blue: 20};
var SELECTED_COLOR = {red: 250, green: 20, blue: 20};
ExtendedOverlay.prototype.select = function (selected) {
    if (this.selected === selected) {
        return;
    }
    this.editOverlay({color: selected ? SELECTED_COLOR : UNSELECTED_COLOR});
    this.selected = selected;
};
// Class methods:
ExtendedOverlay.get = function (key) { // answer the extended overlay data object associated with the given avatar identifier
    return overlays[key];
};
ExtendedOverlay.some = function (iterator) { // Bails early as soon as iterator returns truthy.
    var key;
    for (key in overlays) {
        if (iterator(ExtendedOverlay.get(key))) {
            return;
        }
    }
};
ExtendedOverlay.applyPickRay = function (pickRay, cb) { // cb(overlay) on the one overlay intersected by pickRay, if any.
    var pickedOverlay = Overlays.findRayIntersection(pickRay); // Depends on nearer coverOverlays to extend closer to us than farther ones.
    if (!pickedOverlay.intersects) {
        return;
    }
    ExtendedOverlay.some(function (overlay) { // See if pickedOverlay is one of ours.
        if ((overlay.activeOverlay) === pickedOverlay.overlayID) {
            cb(overlay);
            return true;
        }
    });
};


var pal = new OverlayWindow({
    title: 'People Action List',
    source: 'hifi/Pal.qml',
    width: 480,
    height: 640,
    visible: false
});
pal.fromQml.connect(function (message) {
    switch (message.method) {
    case 'selected':
        var sessionIds = message.params;
        ExtendedOverlay.some(function (overlay) {
            overlay.select(-1 !== sessionIds.indexOf(overlay.key));
        });
        break;
    default:
        print('Unrecognized message from Pal.qml:', JSON.stringify(message));
    }
});

var AVATAR_OVERLAY = Script.resolvePath("assets/images/grabsprite-3.png");
function populateUserList() {
    var data = [];
    var counter = 1;
    AvatarList.getAvatarIdentifiers().forEach(function (id) {
        var avatar = AvatarList.getAvatar(id);
        data.push({
            displayName: avatar.displayName || ('anonymous ' + counter++),
            userName: "fakeAcct" + (id || "Me"),
            sessionId: id || ''
        });
        if (id) { // No overlay for us
            new ExtendedOverlay(id, "sphere", { // 3d so we don't go cross-eyed looking at it, but on top of everything
                solid: true,
                alpha: 0.8,
                color: UNSELECTED_COLOR,
                dimensions: 0.4,
                drawInFront: true
            });
        }
    });
    pal.sendToQml({method: 'users', params: data});
}
var pingPong = true;
function updateOverlays() {
    var eye = Camera.position;
    AvatarList.getAvatarIdentifiers().forEach(function (id) {
        if (!id) {
            return; // don't update ourself
        }
        var overlay = ExtendedOverlay.get(id);
        if (overlay) {
            var avatar = AvatarList.getAvatar(id);
            var target = avatar.position;
            var distance = Vec3.distance(target, eye);
            overlay.ping = pingPong;
            overlay.editOverlay({
                position: target,
                dimensions: 0.05 * distance // constant apparent size
            });
        }
    });
    pingPong = !pingPong;
    ExtendedOverlay.some(function (overlay) { // Remove any that weren't updated. (User is gone.)
        if (overlay.ping === pingPong) {
            overlay.deleteOverlay();
        }
    });
}
function removeOverlays() {
    ExtendedOverlay.some(function (overlay) { overlay.deleteOverlay(); });
}

// Clicks
function handleClick(pickRay) {
    ExtendedOverlay.applyPickRay(pickRay, function (overlay) {
        var message = {method: 'select', params: [overlay.key, !overlay.selected]};
        pal.sendToQml(message);
        return true;
    });
}
function handleMouseEvent(mousePressEvent) { // handleClick if we get one.
    if (!mousePressEvent.isLeftButton) {
        return;
    }
    handleClick(Camera.computePickRay(mousePressEvent.x, mousePressEvent.y));
}
// We get mouseMoveEvents from the handControllers, via handControllerPointer.
// But we dont' get mousePressEvents.
var triggerMapping = Controller.newMapping(Script.resolvePath('') + '-click');
function controllerComputePickRay(hand) {
    var controllerPose = getControllerWorldLocation(hand, true);
    if (controllerPose.valid) {
        return { origin: controllerPose.position, direction: Quat.getUp(controllerPose.orientation) };
    }
}
function makeClickHandler(hand) {
    return function(clicked) {
        if (clicked > 0.85) {
            var pickRay = controllerComputePickRay(hand);
            handleClick(pickRay);
        }
    };
}
triggerMapping.from(Controller.Standard.RTClick).peek().to(makeClickHandler(Controller.Standard.RightHand));
triggerMapping.from(Controller.Standard.LTClick).peek().to(makeClickHandler(Controller.Standard.LeftHand));
        
// Manage the connection between the button and the window.
var toolBar = Toolbars.getToolbar("com.highfidelity.interface.toolbar.system");
var buttonName = "pal";
var button = toolBar.addButton({
    objectName: buttonName,
    imageURL: Script.resolvePath("assets/images/tools/people.svg"),
    visible: true,
    hoverState: 2,
    defaultState: 1,
    buttonState: 1,
    alpha: 0.9
});
function off() {
    Script.update.disconnect(updateOverlays);
    Controller.mousePressEvent.disconnect(handleMouseEvent);
    triggerMapping.disable();
    removeOverlays();
}
function onClicked() {
    if (!pal.visible) {
        populateUserList();
        pal.raise();
        Script.update.connect(updateOverlays);
        Controller.mousePressEvent.connect(handleMouseEvent);
        triggerMapping.enable();
    } else {
        off();
    }
    pal.setVisible(!pal.visible);
}

function onVisibileChanged() {
    button.writeProperty('buttonState', pal.visible ? 0 : 1);
    button.writeProperty('defaultState', pal.visible ? 0 : 1);
    button.writeProperty('hoverState', pal.visible ? 2 : 3);
}
button.clicked.connect(onClicked);
pal.visibleChanged.connect(onVisibileChanged);

Script.scriptEnding.connect(function () {
    button.clicked.disconnect(onClicked);
    toolBar.removeButton(buttonName);
    pal.visibleChanged.disconnect(onVisibileChanged);
    off();
});


// FIXME: }()); // END LOCAL_SCOPE
