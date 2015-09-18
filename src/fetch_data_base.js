/* jshint esnext:true */
/*
 *
 *  Weather extension for GNOME Shell
 *  - Displays a small weather information on the top panel.
 *  - On click, gives a popup with details about the weather.
 *
 * Copyright (C) 2011 - 2015
 *     ecyrbe <ecyrbe+spam@gmail.com>,
 *     Timur Kristof <venemo@msn.com>,
 *     Elad Alfassa <elad@fedoraproject.org>,
 *     Simon Legner <Simon.Legner@gmail.com>,
 *     Christian METZLER <neroth@xeked.com>,
 *     Mark Benjamin weather.gnome.Markie1@dfgh.net,
 *     Mattia Meneguzzo odysseus@fedoraproject.org,
 *     Meng Zhuo <mengzhuo1203+spam@gmail.com>,
 *     Jens Lody <jens@jenslody.de>
 *
 *
 * This file is part of gnome-shell-extension-openweather.
 *
 * gnome-shell-extension-openweather is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * gnome-shell-extension-openweather is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell-extension-openweather.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Config = imports.misc.config;
const Convenience = Me.imports.convenience;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext.domain('gnome-shell-extension-openweather');
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const St = imports.gi.St;
const Util = imports.misc.util;
const _ = Gettext.gettext;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

// Settings
const WEATHER_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.openweather';
const WEATHER_UNIT_KEY = 'unit';
const WEATHER_WIND_SPEED_UNIT_KEY = 'wind-speed-unit';
const WEATHER_WIND_DIRECTION_KEY = 'wind-direction';
const WEATHER_PRESSURE_UNIT_KEY = 'pressure-unit';
const WEATHER_CITY_KEY = 'city';
const WEATHER_ACTUAL_CITY_KEY = 'actual-city';
const WEATHER_TRANSLATE_CONDITION_KEY = 'translate-condition';
const WEATHER_USE_SYMBOLIC_ICONS_KEY = 'use-symbolic-icons';
const WEATHER_USE_TEXT_ON_BUTTONS_KEY = 'use-text-on-buttons';
const WEATHER_SHOW_TEXT_IN_PANEL_KEY = 'show-text-in-panel';
const WEATHER_POSITION_IN_PANEL_KEY = 'position-in-panel';
const WEATHER_SHOW_COMMENT_IN_PANEL_KEY = 'show-comment-in-panel';
const WEATHER_REFRESH_INTERVAL_CURRENT = 'refresh-interval-current';
const WEATHER_REFRESH_INTERVAL_FORECAST = 'refresh-interval-forecast';
const WEATHER_CENTER_FORECAST_KEY = 'center-forecast';
const WEATHER_DAYS_FORECAST = 'days-forecast';
const WEATHER_DECIMAL_PLACES = 'decimal-places';
const WEATHER_OWM_API_KEY = 'appid';

//URL
const WEATHER_URL_HOST = '';
const WEATHER_URL_PORT = 80;
const WEATHER_URL_BASE = 'http://' + WEATHER_URL_HOST;
const WEATHER_URL_CURRENT = WEATHER_URL_BASE + '';
const WEATHER_URL_FORECAST = WEATHER_URL_BASE + '';

// Keep enums in sync with GSettings schemas
const WeatherUnits = {
    CELSIUS: 0,
    FAHRENHEIT: 1,
    KELVIN: 2,
    RANKINE: 3,
    REAUMUR: 4,
    ROEMER: 5,
    DELISLE: 6,
    NEWTON: 7
};

const WeatherWindSpeedUnits = {
    KPH: 0,
    MPH: 1,
    MPS: 2,
    KNOTS: 3,
    FPS: 4,
    BEAUFORT: 5
};

const WeatherPressureUnits = {
    hPa: 0,
    inHg: 1,
    bar: 2,
    Pa: 3,
    kPa: 4,
    atm: 5,
    at: 6,
    Torr: 7,
    psi: 8,
    mmHg: 9
};

const WeatherPosition = {
    CENTER: 0,
    RIGHT: 1,
    LEFT: 2
};

const WEATHER_CONV_MPS_IN_MPH = 2.23693629;
const WEATHER_CONV_MPS_IN_KPH = 3.6;
const WEATHER_CONV_MPS_IN_KNOTS = 1.94384449;
const WEATHER_CONV_MPS_IN_FPS = 3.2808399;

let _httpSession;

const OpenweatherProviderBase = new Lang.Class({
    Name: 'OpenweatherProviderBase',

    _init: function() {
        this.currentWeatherCache = undefined;
        this.forecastWeatherCache = undefined;
        // Load settings
        this.loadConfig();

        // Label
        this._weatherInfo = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            text: _('...')
        });

        this._weatherIcon = new St.Icon({
            icon_name: 'view-refresh' + this.icon_type(),
            style_class: 'system-status-icon openweather-icon'
        });

        // Panel menu item - the current class
        let menuAlignment = 0.25;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            menuAlignment = 1.0 - menuAlignment;
        this.parent(menuAlignment);

        // Putting the panel item together
        let topBox = new St.BoxLayout();
        topBox.add_actor(this._weatherIcon);
        topBox.add_actor(this._weatherInfo);
        this.actor.add_actor(topBox);

        let dummyBox = new St.BoxLayout();
        this.actor.reparent(dummyBox);
        dummyBox.remove_actor(this.actor);
        dummyBox.destroy();

        let children = null;
        switch (this._position_in_panel) {
            case WeatherPosition.LEFT:
                children = Main.panel._leftBox.get_children();
                Main.panel._leftBox.insert_child_at_index(this.actor, children.length);
                break;
            case WeatherPosition.CENTER:
                children = Main.panel._centerBox.get_children();
                Main.panel._centerBox.insert_child_at_index(this.actor, children.length);
                break;
            case WeatherPosition.RIGHT:
                children = Main.panel._rightBox.get_children();
                Main.panel._rightBox.insert_child_at_index(this.actor, 0);
                break;
        }
        if (Main.panel._menus === undefined)
            Main.panel.menuManager.addMenu(this.menu);
        else
            Main.panel._menus.addMenu(this.menu);

        this._old_position_in_panel = this._position_in_panel;

        // Current weather
        this._currentWeather = new St.Bin();
        // Future weather
        this._futureWeather = new St.Bin();

        // Putting the popup item together
        let _itemCurrent = new PopupMenu.PopupBaseMenuItem({
            reactive: false
        });
        let _itemFuture = new PopupMenu.PopupBaseMenuItem({
            reactive: false
        });

        if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION)) {
            _itemCurrent.addActor(this._currentWeather);
            _itemFuture.addActor(this._futureWeather);
        } else {
            _itemCurrent.actor.add_actor(this._currentWeather);
            _itemFuture.actor.add_actor(this._futureWeather);
        }

        this.menu.addMenuItem(_itemCurrent);

        this._separatorItem = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separatorItem);

        this.menu.addMenuItem(_itemFuture);

        let item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        this._selectCity = new PopupMenu.PopupSubMenuMenuItem("");
        this._selectCity.actor.set_height(0);
        this._selectCity._triangle.set_height(0);

        this._buttonMenu = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'openweather-menu-button-container'
        });

        this.rebuildButtonMenu();

        this.menu.addMenuItem(this._buttonMenu);
        this.menu.addMenuItem(this._selectCity);
        this.rebuildSelectCityItem();
        this._selectCity.menu.connect('open-state-changed', Lang.bind(this, function() {
            this._selectCity.actor.remove_style_pseudo_class('open');
        }));

        this.rebuildCurrentWeatherUi();
        this.rebuildFutureWeatherUi();

        this._network_monitor = Gio.network_monitor_get_default();

        this._connected = false;
        this._network_monitor_connection = this._network_monitor.connect('network-changed', Lang.bind(this, this._onNetworkStateChanged));
        this._checkConnectionState();

        this.menu.connect('open-state-changed', Lang.bind(this, this.recalcLayout));
        if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION)) {
            this._needsColorUpdate = true;
            let context = St.ThemeContext.get_for_stage(global.stage);
            this._globalThemeChangedId = context.connect('changed', Lang.bind(this, function(){this._needsColorUpdate = true;}));
        }
    },

    stop: function() {
        if (_httpSession !== undefined)
            _httpSession.abort();

        _httpSession = undefined;

        if (this._timeoutCurrent)
            Mainloop.source_remove(this._timeoutCurrent);

        this._timeoutCurrent = undefined;

        if (this._timeoutForecast)
            Mainloop.source_remove(this._timeoutForecast);

        this._timeoutForecast = undefined;

        if (this._network_monitor_connection) {
            this._network_monitor.disconnect(this._network_monitor_connection);
            this._network_monitor_connection = undefined;
        }

        if (this._settingsC) {
            this._settings.disconnect(this._settingsC);
            this._settingsC = undefined;
        }

        if (this._settingsInterfaceC) {
            this._settingsInterface.disconnect(this._settingsInterfaceC);
            this._settingsInterfaceC = undefined;
        }

        if (this._globalThemeChangedId) {
            let context = St.ThemeContext.get_for_stage(global.stage);
            context.disconnect(this._globalThemeChangedId);
            this._globalThemeChangedId = undefined;
        }
    },

    loadConfig: function() {
        this._settings = Convenience.getSettings(WEATHER_SETTINGS_SCHEMA);
        this._settingsC = this._settings.connect("changed", Lang.bind(this, function() {
            this.rebuildCurrentWeatherUi();
            this.rebuildFutureWeatherUi();
            this.rebuildButtonMenu();
            if (this.locationChanged()) {
                this.currentWeatherCache = undefined;
                this.forecastWeatherCache = undefined;
            }
            this.parseWeatherCurrent();
        }));
    },

    loadConfigInterface: function() {
        let schemaInterface = "org.gnome.desktop.interface";
        if (Gio.Settings.list_schemas().indexOf(schemaInterface) == -1)
            throw _("Schema \"%s\" not found.").replace("%s", schemaInterface);
        this._settingsInterface = new Gio.Settings({
            schema: schemaInterface
        });
        this._settingsInterfaceC = this._settingsInterface.connect("changed", Lang.bind(this, function() {
            this.rebuildCurrentWeatherUi();
            this.rebuildFutureWeatherUi();
            if (this.locationChanged()) {
                this.currentWeatherCache = undefined;
                this.forecastWeatherCache = undefined;
            }
            this.parseWeatherCurrent();
        }));
    },

    _onNetworkStateChanged: function() {
        this._checkConnectionState();
    },

    _checkConnectionState: function() {
        this._connected = this._network_monitor.network_available;
        if (this._connected)
            this.parseWeatherCurrent();
    },

    locationChanged: function() {
        let location = this.extractId(this._city);
        if (this.oldLocation != location) {
            return true;
        }
        return false;
    },

    get _clockFormat() {
        if (!this._settingsInterface)
            this.loadConfigInterface();
        return this._settingsInterface.get_string("clock-format");
    },

    get _units() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_enum(WEATHER_UNIT_KEY);
    },

    set _units(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_enum(WEATHER_UNIT_KEY, v);
    },

    get _wind_speed_units() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_enum(WEATHER_WIND_SPEED_UNIT_KEY);
    },

    set _wind_speed_units(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_enum(WEATHER_WIND_SPEED_UNIT_KEY, v);
    },

    get _wind_direction() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_WIND_DIRECTION_KEY);
    },

    set _wind_direction(v) {
        if (!this._settings)
            this.loadConfig();
        return this._settings.set_boolean(WEATHER_WIND_DIRECTION_KEY, v);
    },

    get _pressure_units() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_enum(WEATHER_PRESSURE_UNIT_KEY);
    },

    set _pressure_units(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_enum(WEATHER_PRESSURE_UNIT_KEY, v);
    },

    get _cities() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_string(WEATHER_CITY_KEY);
    },

    set _cities(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_string(WEATHER_CITY_KEY, v);
    },

    get _actual_city() {
        if (!this._settings)
            this.loadConfig();
        var a = this._settings.get_int(WEATHER_ACTUAL_CITY_KEY);
        var b = a;
        var cities = this._cities.split(" && ");

        if (typeof cities != "object")
            cities = [cities];

        var l = cities.length - 1;

        if (a < 0)
            a = 0;

        if (l < 0)
            l = 0;

        if (a > l)
            a = l;

        return a;
    },

    set _actual_city(a) {
        if (!this._settings)
            this.loadConfig();
        var cities = this._cities.split(" && ");

        if (typeof cities != "object")
            cities = [cities];

        var l = cities.length - 1;

        if (a < 0)
            a = 0;

        if (l < 0)
            l = 0;

        if (a > l)
            a = l;

        this._settings.set_int(WEATHER_ACTUAL_CITY_KEY, a);
    },

    get _city() {
        let cities = this._cities;
        let cities = cities.split(" && ");
        if (cities && typeof cities == "string")
            cities = [cities];
        if (!cities[0])
            return "";
        cities = cities[this._actual_city];
        return cities;
    },

    set _city(v) {
        let cities = this._cities;
        cities = cities.split(" && ");
        if (cities && typeof cities == "string")
            cities = [cities];
        if (!cities[0])
            cities = [];
        cities.splice(this.actual_city, 1, v);
        cities = cities.join(" && ");
        if (typeof cities != "string")
            cities = cities[0];
        this._cities = cities;
    },

    get _translate_condition() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_TRANSLATE_CONDITION_KEY);
    },

    set _translate_condition(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_TRANSLATE_CONDITION_KEY, v);
    },

    get _icon_type() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_USE_SYMBOLIC_ICONS_KEY) ? 1 : 0;
    },

    set _icon_type(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_USE_SYMBOLIC_ICONS_KEY, v);
    },

    get _use_text_on_buttons() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_USE_TEXT_ON_BUTTONS_KEY) ? 1 : 0;
    },

    set _use_text_on_buttons(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_USE_TEXT_ON_BUTTONS_KEY, v);
    },

    get _text_in_panel() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_SHOW_TEXT_IN_PANEL_KEY);
    },

    set _text_in_panel(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_SHOW_TEXT_IN_PANEL_KEY, v);
    },

    get _position_in_panel() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_enum(WEATHER_POSITION_IN_PANEL_KEY);
    },

    set _position_in_panel(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_enum(WEATHER_POSITION_IN_PANEL_KEY, v);
    },

    get _comment_in_panel() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_SHOW_COMMENT_IN_PANEL_KEY);
    },

    set _comment_in_panel(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_SHOW_COMMENT_IN_PANEL_KEY, v);
    },

    get _refresh_interval_current() {
        if (!this._settings)
            this.loadConfig();
        let v = this._settings.get_int(WEATHER_REFRESH_INTERVAL_CURRENT);
        return ((v >= 600) ? v : 600);
    },

    set _refresh_interval_current(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_int(WEATHER_REFRESH_INTERVAL_CURRENT, ((v >= 600) ? v : 600));
    },

    get _refresh_interval_forecast() {
        if (!this._settings)
            this.loadConfig();
        let v = this._settings.get_int(WEATHER_REFRESH_INTERVAL_FORECAST);
        return ((v >= 600) ? v : 600);
    },

    set _refresh_interval_forecast(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_int(WEATHER_REFRESH_INTERVAL_FORECAST, ((v >= 600) ? v : 600));
    },

    get _center_forecast() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_boolean(WEATHER_CENTER_FORECAST_KEY);
    },

    set _center_forecast(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_boolean(WEATHER_CENTER_FORECAST_KEY, v);
    },

    get _days_forecast() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_int(WEATHER_DAYS_FORECAST);
    },

    set _days_forecast(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_int(WEATHER_DAYS_FORECAST, v);
    },

    get _decimal_places() {
        if (!this._settings)
            this.loadConfig();
        return this._settings.get_int(WEATHER_DECIMAL_PLACES);
    },

    set _decimal_places(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_int(WEATHER_DECIMAL_PLACES, v);
    },

    get _appid() {
        if (!this._settings)
            this.loadConfig();
        let key = this._settings.get_string(WEATHER_OWM_API_KEY);
        return (key.length == 32) ? key : '';
    },

    set _appid(v) {
        if (!this._settings)
            this.loadConfig();
        this._settings.set_string(WEATHER_OWM_API_KEY, v);
    },

    createButton: function(iconName, accessibleName) {
        let button;

        if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION)) {
            button = new St.Button({
                reactive: true,
                can_focus: true,
                track_hover: true,
                accessible_name: accessibleName,
                style_class: 'popup-menu-item openweather-button'
            });
            button.child = new St.Icon({
                icon_name: iconName
            });
            button.connect('notify::hover', Lang.bind(this, this._onButtonHoverChanged));
        } else
            button = Main.panel.statusArea.aggregateMenu._system._createActionButton(iconName, accessibleName);

        return button;
    },

    _onButtonHoverChanged: function(actor, event) {
        if (actor.hover) {
            actor.add_style_pseudo_class('hover');
            actor.set_style(this._button_background_style);
        } else {
            actor.remove_style_pseudo_class('hover');
            actor.set_style('background-color:;');
            if (actor != this._urlButton)
                actor.set_style(this._button_border_style);
            }
    },

    _updateButtonColors: function() {
        if (!this._needsColorUpdate)
            return;
            this._needsColorUpdate = false;
        let color;
        if (ExtensionUtils.versionCheck(['3.6'], Config.PACKAGE_VERSION))
            color = this._separatorItem._drawingArea.get_theme_node().get_color('-gradient-end');
        else
            color = this._separatorItem._separator.actor.get_theme_node().get_color('-gradient-end');

            let alpha = (Math.round(color.alpha / 2.55) / 100);

            if (color.red > 0 && color.green > 0 && color.blue > 0)
                this._button_border_style = 'border:1px solid rgb(' + Math.round(alpha * color.red) + ',' + Math.round(alpha * color.green) + ',' + Math.round(alpha * color.blue) + ');';
            else
                this._button_border_style = 'border:1px solid rgba(' + color.red + ',' + color.green + ',' + color.blue + ',' + alpha + ');';

            this._locationButton.set_style(this._button_border_style);
            this._reloadButton.set_style(this._button_border_style);
            this._prefsButton.set_style(this._button_border_style);

            this._buttonMenu.actor.add_style_pseudo_class('active');
            color = this._buttonMenu.actor.get_theme_node().get_background_color();
            this._button_background_style = 'background-color:rgba(' + color.red + ',' + color.green + ',' + color.blue + ',' + (Math.round(color.alpha / 2.55) / 100) + ');';
            this._buttonMenu.actor.remove_style_pseudo_class('active');
    },

    rebuildButtonMenu: function() {
        if (this._buttonBox) {
        if (this._buttonBox1) {
            this._buttonBox1.destroy();
            this._buttonBox1 = undefined;

        }
        if (this._buttonBox2) {
            this._buttonBox2.destroy();
            this._buttonBox2 = undefined;
            }
            this._buttonMenu.removeActor(this._buttonBox);
            this._buttonBox.destroy();
            this._buttonBox = undefined;
        }

        if (this._buttonBox1) {
            this._buttonBox1.destroy();
            this._buttonBox1 = undefined;
        }
        if (this._buttonBox2) {
            this._buttonBox2.destroy();
            this._buttonBox2 = undefined;
        }

        this._locationButton = this.createButton('find-location-symbolic', _("Locations"));
        if (this._use_text_on_buttons)
            this._locationButton.set_label(this._locationButton.get_accessible_name());

        this._locationButton.connect('clicked', Lang.bind(this, function() {
            if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION))
                this._selectCity.menu.toggle();
            else
               this._selectCity._setOpenState(!this._selectCity._getOpenState());
        }));
        this._buttonBox1 = new St.BoxLayout({
            style_class: 'openweather-button-box'
        });
        this._buttonBox1.add_actor(this._locationButton);

        this._reloadButton = this.createButton('view-refresh-symbolic', _("Reload Weather Information"));
        if (this._use_text_on_buttons)
            this._reloadButton.set_label(this._reloadButton.get_accessible_name());
        this._reloadButton.connect('clicked', Lang.bind(this, function() {
            this.currentWeatherCache = undefined;
            this.forecastWeatherCache = undefined;
            this.parseWeatherCurrent();
            this.recalcLayout();
        }));
        this._buttonBox1.add_actor(this._reloadButton);


        this._buttonBox2 = new St.BoxLayout({
            style_class: 'openweather-button-box'
        });

        this._urlButton = new St.Button({
            label: _("Weather data provided by:") + (this._use_text_on_buttons ? "\n" : "  ") + WEATHER_URL_BASE,
            style_class: 'system-menu-action openweather-provider'
        });
        if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION)) {
            this._urlButton.connect('notify::hover', Lang.bind(this, this._onButtonHoverChanged));
        }
        this._urlButton.connect('clicked', Lang.bind(this, function() {
            this.menu.actor.hide();
            let title = ;
            Main.notifyError(_("Not implemented"),
                             _("Opening the website of the weatherprovider is not (yet) implemeted !"));
        }));

        this._buttonBox2.add_actor(this._urlButton);


        this._prefsButton = this.createButton('preferences-system-symbolic', _("Weather Settings"));
        if (this._use_text_on_buttons)
            this._prefsButton.set_label(this._prefsButton.get_accessible_name());
        this._prefsButton.connect('clicked', Lang.bind(this, this._onPreferencesActivate));
        this._buttonBox2.add_actor(this._prefsButton);

        if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION)) {
            this._buttonBox = new St.BoxLayout();
            this._buttonBox1.add_style_class_name('openweather-button-box-38');
            this._buttonBox2.add_style_class_name('openweather-button-box-38');
            this._buttonBox.add_actor(this._buttonBox1);
            this._buttonBox.add_actor(this._buttonBox2);

            this._buttonMenu.addActor(this._buttonBox);
            this._needsColorUpdate = true;
        } else {
            this._buttonMenu.actor.add_actor(this._buttonBox1);
            this._buttonMenu.actor.add_actor(this._buttonBox2);
        }
        this._buttonBox1MinWidth = undefined;
    },
    rebuildSelectCityItem: function() {
        this._selectCity.menu.removeAll();
        let item = null;

        let cities = this._cities;
        cities = cities.split(" && ");
        if (cities && typeof cities == "string")
            cities = [cities];
        if (!cities[0])
            return;

        for (let i = 0; cities.length > i; i++) {
            item = new PopupMenu.PopupMenuItem(this.extractLocation(cities[i]));
            item.location = i;
            if (i == this._actual_city) {
                if (ExtensionUtils.versionCheck(['3.6', '3.8'], Config.PACKAGE_VERSION))
                    item.setShowDot(true);
                else
                    item.setOrnament(PopupMenu.Ornament.DOT);
            }

            this._selectCity.menu.addMenuItem(item);
            // override the items default onActivate-handler, to keep the ui open while chosing the location
            item.activate = this._onActivate;
        }

        if (cities.length == 1)
            this._selectCity.actor.hide();
        else
            this._selectCity.actor.show();

    },

    _onActivate: function() {
        openweatherMenu._actual_city = this.location;
    },

    extractLocation: function() {
        if (!arguments[0])
            return "";

        if (arguments[0].search(">") == -1)
            return _("Invalid city");
        return arguments[0].split(">")[1];
    },

    extractCity: function() {
        if (!arguments[0])
            return "";
        let city = this.extractLocation(arguments[0]);
        if (city.indexOf("(") == -1)
            return _("Invalid city");
        return city.split("(")[0].trim();
    },

    extractId: function() {
        if (!arguments[0])
            return 0;

        if (arguments[0].search(">") == -1)
            return 0;
        return arguments[0].split(">")[0];
    },

    updateCities: function() {
        let cities = this._cities;

        cities = cities.split(" && ");
        if (cities && typeof cities == "string")
            cities = [cities];
        if (!cities[0])
            cities = [];

        if (cities.length === 0) {
            this._cities = "2516479>Eivissa (CA)";
            this.updateCities();
            return;
        }

        for (let a in cities) {
            if (!this.extractCity(cities[a])) {
                let params = {
                    q: cities[a],
                    type: 'like'
                };
                if (this._appid)
                    params.APPID = this._appid;

                this.load_json_async(WEATHER_URL_CURRENT, params, Lang.bind(this, this._updateCitiesCallback));
                return;
            } else
                continue;
        }
    },

    _updateCitiesCallback: function() {
        let city = arguments[0];

        if (Number(city.cod) != 200)
            return;

        let cityText = city.coord + ">" + city.name;

        if (city.sys)
            cityText += " (" + city.sys.country + ")";

        cities.splice(a, 1, cityText);

        cities = cities.join(" && ");
        if (typeof cities != "string")
            cities = cities[0];
        this._cities = cities;
//        this.updateCities();
    },

    _onPreferencesActivate: function() {
        this.menu.actor.hide();
        Util.spawn(["gnome-shell-extension-prefs", "openweather-extension@jenslody.de"]);
        return 0;
    },

    recalcLayout: function() {
        if (!this.menu.isOpen)
            return;
        this._updateButtonColors();
        if(this._buttonBox1MinWidth === undefined)
            this._buttonBox1MinWidth = this._buttonBox1.get_width();
        this._buttonBox1.set_width(Math.max(this._buttonBox1MinWidth, this._currentWeather.get_width() - this._buttonBox2.get_width()));
        if (this._forecastScrollBox !== undefined && this._forecastBox !== undefined && this._currentWeather !== undefined) {
            this._forecastScrollBox.set_width(Math.max(this._currentWeather.get_width(), (this._buttonBox1.get_width() + this._buttonBox2.get_width())));
            this._forecastScrollBox.show();
            if (this._forecastBox.get_preferred_width(this._forecastBox.get_height())[0] > this._currentWeather.get_width()) {
                this._forecastScrollBox.hscroll.margin_top = 10;
                this._forecastScrollBox.hscroll.show();
            } else {
                this._forecastScrollBox.hscroll.margin_top = 0;
                this._forecastScrollBox.hscroll.hide();
            }
        }
    },

    unit_to_unicode: function() {
        if (this._units == WeatherUnits.FAHRENHEIT)
            return '\u00B0F';
        else if (this._units == WeatherUnits.KELVIN)
            return 'K';
        else if (this._units == WeatherUnits.RANKINE)
            return '\u00B0Ra';
        else if (this._units == WeatherUnits.REAUMUR)
            return '\u00B0R\u00E9';
        else if (this._units == WeatherUnits.ROEMER)
            return '\u00B0R\u00F8';
        else if (this._units == WeatherUnits.DELISLE)
            return '\u00B0De';
        else if (this._units == WeatherUnits.NEWTON)
            return '\u00B0N';
        else
            return '\u00B0C';
    },

    get_weather_icon: function(code) {
        // see http://bugs.openweathermap.org/projects/api/wiki/Weather_Condition_Codes
        // fallback icons are: weather-clear-night weather-clear weather-few-clouds-night weather-few-clouds weather-fog weather-overcast weather-severe-alert weather-showers weather-showers-scattered weather-snow weather-storm
        /*
weather-clouds-night.png
weather-freezing-rain.png
weather-hail.png
weather-many-clouds.png
weather-showers-day.png
weather-showers-night.png
weather-showers-scattered-day.png
weather-showers-scattered-night.png
weather-snow-rain.png
weather-snow-scattered-day.png
weather-snow-scattered-night.png
weather-snow-scattered.png
weather-storm-day.png
weather-storm-night.png

weather-severe-alert-symbolic.svg


weather-clear-night.png = weather-clear-night-symbolic.svg
weather-clear.png = weather-clear-symbolic.svg
weather-clouds.png = weather-overcast-symbolic.svg
weather-few-clouds-night.png = weather-few-clouds-night-symbolic.svg
weather-few-clouds.png = weather-few-clouds-symbolic.svg
weather-mist.png = weather-fog-symbolic.svg
weather-showers-scattered.png = weather-showers-scattered-symbolic.svg
weather-showers.png = weather-showers-symbolic.svg
weather-snow.png = weather-snow-symbolic.svg
weather-storm.png = weather-storm-symbolic.svg

*/
        switch (parseInt(code, 10)) {
            case 200: //thunderstorm with light rain
            case 201: //thunderstorm with rain
            case 202: //thunderstorm with heavy rain
            case 210: //light thunderstorm
            case 211: //thunderstorm
            case 212: //heavy thunderstorm
            case 221: //ragged thunderstorm
            case 230: //thunderstorm with light drizzle
            case 231: //thunderstorm with drizzle
            case 232: //thunderstorm with heavy drizzle
                return ['weather-storm'];
            case 300: //light intensity drizzle
            case 301: //drizzle
            case 302: //heavy intensity drizzle
            case 310: //light intensity drizzle rain
            case 311: //drizzle rain
            case 312: //heavy intensity drizzle rain
            case 313: //shower rain and drizzle
            case 314: //heavy shower rain and drizzle
            case 321: //shower drizzle
                return ['weather-showers'];
            case 500: //light rain
            case 501: //moderate rain
            case 502: //heavy intensity rain
            case 503: //very heavy rain
            case 504: //extreme rain
                return ['weather-showers-scattered', 'weather-showers'];
            case 511: //freezing rain
                return ['weather-freezing-rain', 'weather-showers'];
            case 520: //light intensity shower rain
            case 521: //shower rain
            case 522: //heavy intensity shower rain
            case 531: //ragged shower rain
                return ['weather-showers'];
            case 600: //light snow
            case 601: //snow
            case 602: //heavy snow
            case 611: //sleet
            case 612: //shower sleet
            case 615: //light rain and snow
            case 616: //rain and snow
            case 620: //light shower snow
            case 621: //shower snow
            case 622: //heavy shower snow
                return ['weather-snow'];
            case 701: //mist
            case 711: //smoke
            case 721: //haze
            case 741: //Fog
                return ['weather-fog'];
            case 731: //Sand/Dust Whirls
            case 751: //sand
            case 761: //dust
            case 762: //VOLCANIC ASH
            case 771: //SQUALLS
            case 781: //TORNADO
                return ['weather-severe-alert'];
            case 800: //sky is clear
                return ['weather-clear'];
            case 801: //few clouds
            case 802: //scattered clouds
                return ['weather-few-clouds'];
            case 803: //broken clouds
                return ['weather-many-clouds', 'weather-overcast'];
            case 804: //overcast clouds
                return ['weather-overcast'];
            default:
                return ['weather-severe-alert'];
        }
    },

    get_weather_icon_safely: function(code, night) {
        let iconname = this.get_weather_icon(code);
        for (let i = 0; i < iconname.length; i++) {
            if (night && this.has_icon(iconname[i] + '-night'))
                return iconname[i] + '-night' + this.icon_type();
            if (this.has_icon(iconname[i]))
                return iconname[i] + this.icon_type();
        }
        return 'weather-severe-alert' + this.icon_type();
    },

    has_icon: function(icon) {
        return Gtk.IconTheme.get_default().has_icon(icon + this.icon_type());
    },

    get_weather_condition: function(code) {
        switch (parseInt(code, 10)) {
            case 200: //thunderstorm with light rain
                return _('thunderstorm with light rain');
            case 201: //thunderstorm with rain
                return _('thunderstorm with rain');
            case 202: //thunderstorm with heavy rain
                return _('thunderstorm with heavy rain');
            case 210: //light thunderstorm
                return _('light thunderstorm');
            case 211: //thunderstorm
                return _('thunderstorm');
            case 212: //heavy thunderstorm
                return _('heavy thunderstorm');
            case 221: //ragged thunderstorm
                return _('ragged thunderstorm');
            case 230: //thunderstorm with light drizzle
                return _('thunderstorm with light drizzle');
            case 231: //thunderstorm with drizzle
                return _('thunderstorm with drizzle');
            case 232: //thunderstorm with heavy drizzle
                return _('thunderstorm with heavy drizzle');
            case 300: //light intensity drizzle
                return _('light intensity drizzle');
            case 301: //drizzle
                return _('drizzle');
            case 302: //heavy intensity drizzle
                return _('heavy intensity drizzle');
            case 310: //light intensity drizzle rain
                return _('light intensity drizzle rain');
            case 311: //drizzle rain
                return _('drizzle rain');
            case 312: //heavy intensity drizzle rain
                return _('heavy intensity drizzle rain');
            case 313: //shower rain and drizzle
                return _('shower rain and drizzle');
            case 314: //heavy shower rain and drizzle
                return _('heavy shower rain and drizzle');
            case 321: //shower drizzle
                return _('shower drizzle');
            case 500: //light rain
                return _('light rain');
            case 501: //moderate rain
                return _('moderate rain');
            case 502: //heavy intensity rain
                return _('heavy intensity rain');
            case 503: //very heavy rain
                return _('very heavy rain');
            case 504: //extreme rain
                return _('extreme rain');
            case 511: //freezing rain
                return _('freezing rain');
            case 520: //light intensity shower rain
                return _('light intensity shower rain');
            case 521: //shower rain
                return _('shower rain');
            case 522: //heavy intensity shower rain
                return _('heavy intensity shower rain');
            case 531: //ragged shower rain
                return _('ragged shower rain');
            case 600: //light snow
                return _('light snow');
            case 601: //snow
                return _('snow');
            case 602: //heavy snow
                return _('heavy snow');
            case 611: //sleet
                return _('sleet');
            case 612: //shower sleet
                return _('shower sleet');
            case 615: //light rain and snow
                return _('light rain and snow');
            case 616: //rain and snow
                return _('rain and snow');
            case 620: //light shower snow
                return _('light shower snow');
            case 621: //shower snow
                return _('shower snow');
            case 622: //heavy shower snow
                return _('heavy shower snow');
            case 701: //mist
                return _('mist');
            case 711: //smoke
                return _('smoke');
            case 721: //haze
                return _('haze');
            case 731: //Sand/Dust Whirls
                return _('Sand/Dust Whirls');
            case 741: //Fog
                return _('Fog');
            case 751: //sand
                return _('sand');
            case 761: //dust
                return _('dust');
            case 762: //VOLCANIC ASH
                return _('VOLCANIC ASH');
            case 771: //SQUALLS
                return _('SQUALLS');
            case 781: //TORNADO
                return _('TORNADO');
            case 800: //sky is clear
                return _('sky is clear');
            case 801: //few clouds
                return _('few clouds');
            case 802: //scattered clouds
                return _('scattered clouds');
            case 803: //broken clouds
                return _('broken clouds');
            case 804: //overcast clouds
                return _('overcast clouds');
            default:
                return _('Not available');
        }
    },

    toFahrenheit: function(t) {
        return ((Number(t) * 1.8) + 32).toFixed(this._decimal_places);
    },

    toKelvin: function(t) {
        return (Number(t) + 273.15).toFixed(this._decimal_places);
    },

    toRankine: function(t) {
        return ((Number(t) * 1.8) + 491.67).toFixed(this._decimal_places);
    },

    toReaumur: function(t) {
        return (Number(t) * 0.8).toFixed(this._decimal_places);
    },

    toRoemer: function(t) {
        return ((Number(t) * 21 / 40) + 7.5).toFixed(this._decimal_places);
    },

    toDelisle: function(t) {
        return ((100 - Number(t)) * 1.5).toFixed(this._decimal_places);
    },

    toNewton: function(t) {
        return (Number(t) - 0.33).toFixed(this._decimal_places);
    },

    toInHg: function(p /*, t*/ ) {
        return (p / 33.86530749).toFixed(this._decimal_places);
    },

    toBeaufort: function(w, t) {
        if (w < 0.3)
            return (!t) ? "0" : "(" + _("Calm") + ")";

        else if (w >= 0.3 && w <= 1.5)
            return (!t) ? "1" : "(" + _("Light air") + ")";

        else if (w > 1.5 && w <= 3.4)
            return (!t) ? "2" : "(" + _("Light breeze") + ")";

        else if (w > 3.4 && w <= 5.4)
            return (!t) ? "3" : "(" + _("Gentle breeze") + ")";

        else if (w > 5, 4 && w <= 7.9)
            return (!t) ? "4" : "(" + _("Moderate breeze") + ")";

        else if (w > 7.9 && w <= 10.7)
            return (!t) ? "5" : "(" + _("Fresh breeze") + ")";

        else if (w > 10.7 && w <= 13.8)
            return (!t) ? "6" : "(" + _("Strong breeze") + ")";

        else if (w > 13.8 && w <= 17.1)
            return (!t) ? "7" : "(" + _("Moderate gale") + ")";

        else if (w > 17.1 && w <= 20.7)
            return (!t) ? "8" : "(" + _("Fresh gale") + ")";

        else if (w > 20.7 && w <= 24.4)
            return (!t) ? "9" : "(" + _("Strong gale") + ")";

        else if (w > 24.4 && w <= 28.4)
            return (!t) ? "10" : "(" + _("Storm") + ")";

        else if (w > 28.4 && w <= 32.6)
            return (!t) ? "11" : "(" + _("Violent storm") + ")";

        else
            return (!t) ? "12" : "(" + _("Hurricane") + ")";
    },

    get_locale_day: function(abr) {
        let days = [_('Sunday'), _('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday')];
        return days[abr];
    },

    get_wind_direction: function(deg) {
        let arrows = ["\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197", "\u2192", "\u2198"];
        let letters = [_('N'), _('NE'), _('E'), _('SE'), _('S'), _('SW'), _('W'), _('NW')];
        let idx = Math.round(deg / 45) % arrows.length;
        return (this._wind_direction) ? arrows[idx] : letters[idx];
    },

    icon_type: function(icon_name) {
        if (!icon_name)
            if (this._icon_type)
                return "-symbolic";
            else
                return "";

        if (this._icon_type)
            if (String(icon_name).search("-symbolic") != -1)
                return icon_name;
            else
                return icon_name + "-symbolic";
            else
        if (String(icon_name).search("-symbolic") != -1)
            return String(icon_name).replace("-symbolic", "");
        else
            return icon_name;
    },

    load_json_async: function(url, params, fun) {
        if (_httpSession === undefined) {
            if (ExtensionUtils.versionCheck(['3.6'], Config.PACKAGE_VERSION)) {
                // Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64) (Simon Legner)
                _httpSession = new Soup.SessionAsync();
                Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
            } else
                _httpSession = new Soup.Session();
        }

        let message = Soup.form_request_new_from_hash('GET', url, params);

        _httpSession.queue_message(message, Lang.bind(this, function(_httpSession, message) {

            try {
                if (!message.response_body.data) {
                    fun.call(this, 0);
                    return;
                }
                let jp = JSON.parse(message.response_body.data);
                fun.call(this, jp);
            } catch (e) {
                fun.call(this, 0);
                return;
            }
        }));
        return;
    },

    parseWeatherCurrent: function() {
        if (this.currentWeatherCache === undefined) {
            this.refreshWeatherCurrent();
            return;
        }

        if (this._old_position_in_panel != this._position_in_panel) {
            switch (this._old_position_in_panel) {
                case WeatherPosition.LEFT:
                    Main.panel._leftBox.remove_actor(this.actor);
                    break;
                case WeatherPosition.CENTER:
                    Main.panel._centerBox.remove_actor(this.actor);
                    break;
                case WeatherPosition.RIGHT:
                    Main.panel._rightBox.remove_actor(this.actor);
                    break;
            }

            let children = null;
            switch (this._position_in_panel) {
                case WeatherPosition.LEFT:
                    children = Main.panel._leftBox.get_children();
                    Main.panel._leftBox.insert_child_at_index(this.actor, children.length);
                    break;
                case WeatherPosition.CENTER:
                    children = Main.panel._centerBox.get_children();
                    Main.panel._centerBox.insert_child_at_index(this.actor, children.length);
                    break;
                case WeatherPosition.RIGHT:
                    children = Main.panel._rightBox.get_children();
                    Main.panel._rightBox.insert_child_at_index(this.actor, 0);
                    break;
            }
            this._old_position_in_panel = this._position_in_panel;
        }

        let json = this.currentWeatherCache;
        // Refresh current weather
        let location = this.extractLocation(this._city);

        let comment = json.weather[0].description;
        if (this._translate_condition)
            comment = this.get_weather_condition(json.weather[0].id);

        let temperature = json.main.temp;
        let cloudiness = json.clouds.all;
        let humidity = json.main.humidity + ' %';
        let pressure = json.main.pressure;
        let pressure_unit = 'hPa';

        let wind_direction = this.get_wind_direction(json.wind.deg);
        let wind = json.wind.speed;
        let wind_unit = 'm/s';

        let sunrise = new Date(json.sys.sunrise * 1000);
        let sunset = new Date(json.sys.sunset * 1000);
        let now = new Date();

        let iconname = this.get_weather_icon_safely(json.weather[0].id, now < sunrise || now > sunset);

        if (this.lastBuildId === undefined)
            this.lastBuildId = 0;

        if (this.lastBuildDate === undefined)
            this.lastBuildDate = 0;

        if (this.lastBuildId != json.dt || !this.lastBuildDate) {
            this.lastBuildId = json.dt;
            this.lastBuildDate = new Date(this.lastBuildId * 1000);
        }

        switch (this._pressure_units) {
            case WeatherPressureUnits.inHg:
                pressure = this.toInHg(pressure);
                pressure_unit = "inHg";
                break;

            case WeatherPressureUnits.hPa:
                pressure = pressure.toFixed(this._decimal_places);
                pressure_unit = "hPa";
                break;

            case WeatherPressureUnits.bar:
                pressure = (pressure / 1000).toFixed(this._decimal_places);
                pressure_unit = "bar";
                break;

            case WeatherPressureUnits.Pa:
                pressure = (pressure * 100).toFixed(this._decimal_places);
                pressure_unit = "Pa";
                break;

            case WeatherPressureUnits.kPa:
                pressure = (pressure / 10).toFixed(this._decimal_places);
                pressure_unit = "kPa";
                break;

            case WeatherPressureUnits.atm:
                pressure = (pressure * 0.000986923267).toFixed(this._decimal_places);
                pressure_unit = "atm";
                break;

            case WeatherPressureUnits.at:
                pressure = (pressure * 0.00101971621298).toFixed(this._decimal_places);
                pressure_unit = "at";
                break;

            case WeatherPressureUnits.Torr:
                pressure = (pressure * 0.750061683).toFixed(this._decimal_places);
                pressure_unit = "Torr";
                break;

            case WeatherPressureUnits.psi:
                pressure = (pressure * 0.0145037738).toFixed(this._decimal_places);
                pressure_unit = "psi";
                break;
        }

        switch (this._units) {
            case WeatherUnits.FAHRENHEIT:
                temperature = this.toFahrenheit(temperature);
                break;

            case WeatherUnits.CELSIUS:
                temperature = temperature.toFixed(this._decimal_places);
                break;

            case WeatherUnits.KELVIN:
                temperature = this.toKelvin(temperature);
                break;

            case WeatherUnits.RANKINE:
                temperature = this.toRankine(temperature);
                break;

            case WeatherUnits.REAUMUR:
                temperature = this.toReaumur(temperature);
                break;

            case WeatherUnits.ROEMER:
                temperature = this.toRoemer(temperature);
                break;

            case WeatherUnits.DELISLE:
                temperature = this.toDelisle(temperature);
                break;

            case WeatherUnits.NEWTON:
                temperature = this.toNewton(temperature);
                break;
        }

        let lastBuild = '-';

        if (this._clockFormat == "24h") {
            sunrise = sunrise.toLocaleFormat("%R");
            sunset = sunset.toLocaleFormat("%R");
            lastBuild = this.lastBuildDate.toLocaleFormat("%R");
        } else {
            sunrise = sunrise.toLocaleFormat("%I:%M %p");
            sunset = sunset.toLocaleFormat("%I:%M %p");
            lastBuild = this.lastBuildDate.toLocaleFormat("%I:%M %p");
        }

        let beginOfDay = new Date(new Date().setHours(0, 0, 0, 0));
        let d = Math.floor((this.lastBuildDate.getTime() - beginOfDay.getTime()) / 86400000);
        if (d < 0) {
            lastBuild = _("Yesterday");
            if (d < -1)
                lastBuild = _("%s days ago").replace("%s", -1 * d);
        }

        this._currentWeatherIcon.icon_name = this._weatherIcon.icon_name = iconname;

        let weatherInfoC = "";
        let weatherInfoT = "";

        if (this._comment_in_panel)
            weatherInfoC = comment;

        if (this._text_in_panel)
            weatherInfoT = parseFloat(temperature).toLocaleString() + ' ' + this.unit_to_unicode();

        this._weatherInfo.text = weatherInfoC + ((weatherInfoC && weatherInfoT) ? ", " : "") + weatherInfoT;

        this._currentWeatherSummary.text = comment + ", " + parseFloat(temperature).toLocaleString() + ' ' + this.unit_to_unicode();
        this._currentWeatherLocation.text = location;
        this._currentWeatherTemperature.text = cloudiness + ' %';
        this._currentWeatherHumidity.text = parseFloat(humidity).toLocaleString() + ' %';
        this._currentWeatherPressure.text = parseFloat(pressure).toLocaleString() + ' ' + pressure_unit;
        this._currentWeatherSunrise.text = sunrise;
        this._currentWeatherSunset.text = sunset;
        this._currentWeatherBuild.text = lastBuild;

        // Override wind units with our preference
        switch (this._wind_speed_units) {
            case WeatherWindSpeedUnits.MPH:
                wind = (wind * WEATHER_CONV_MPS_IN_MPH).toFixed(this._decimal_places);
                wind_unit = 'mph';
                break;

            case WeatherWindSpeedUnits.KPH:
                wind = (wind * WEATHER_CONV_MPS_IN_KPH).toFixed(this._decimal_places);
                wind_unit = 'km/h';
                break;

            case WeatherWindSpeedUnits.MPS:
                wind = wind.toFixed(this._decimal_places);
                break;

            case WeatherWindSpeedUnits.KNOTS:
                wind = (wind * WEATHER_CONV_MPS_IN_KNOTS).toFixed(this._decimal_places);
                wind_unit = 'kn';
                break;

            case WeatherWindSpeedUnits.FPS:
                wind = (wind * WEATHER_CONV_MPS_IN_FPS).toFixed(this._decimal_places);
                wind_unit = 'ft/s';
                break;

            case WeatherWindSpeedUnits.BEAUFORT:
                wind_unit = this.toBeaufort(wind, true);
                wind = this.toBeaufort(wind);
        }

        if (!wind)
            this._currentWeatherWind.text = '\u2013';
        else if (wind === 0 || !wind_direction)
            this._currentWeatherWind.text = parseFloat(wind).toLocaleString() + ' ' + wind_unit;
        else // i.e. wind > 0 && wind_direction
            this._currentWeatherWind.text = wind_direction + ' ' + parseFloat(wind).toLocaleString() + ' ' + wind_unit;

        this.parseWeatherForecast();
        this.recalcLayout();
    },

    refreshWeatherCurrent: function() {
        if (!this.extractId(this._city)) {
            this.updateCities();
            return;
        }
        this.oldLocation = this.extractId(this._city);

        let params = {
            id: this.oldLocation,
            units: 'metric'
        };
        if (this._appid)
            params.APPID = this._appid;

        this.load_json_async(WEATHER_URL_CURRENT, params, function(json) {
            if (json && (Number(json.cod) == 200)) {

                if (this.currentWeatherCache != json)
                    this.currentWeatherCache = json;

                this.rebuildSelectCityItem();

                this.parseWeatherCurrent();
            } else {
                // we are connected, but get no (or no correct) data, so invalidate
                // the shown data and reload after 10 minutes (recommendded by openweathermap.org)
                this.rebuildCurrentWeatherUi();
                this.reloadWeatherCurrent(600);
            }
        });
        this.reloadWeatherCurrent(this._refresh_interval_current);
    },

    reloadWeatherCurrent: function(interval) {
        if (this._timeoutCurrent) {
            Mainloop.source_remove(this._timeoutCurrent);
        }
        this._timeoutCurrent = Mainloop.timeout_add_seconds(interval, Lang.bind(this, function() {
            this.currentWeatherCache = undefined;
            if (this._connected)
                this.parseWeatherCurrent();
            else
                this.rebuildCurrentWeatherUi();
            return true;
        }));
    },

    parseWeatherForecast: function() {
        if (this.forecastWeatherCache === undefined) {
            this.refreshWeatherForecast();
            return;
        }

        let forecast = this.forecastWeatherCache;
        let beginOfDay = new Date(new Date().setHours(0, 0, 0, 0));

        // Refresh forecast
        for (let i = 0; i < this._days_forecast; i++) {
            let forecastUi = this._forecast[i];
            let forecastData = forecast[i];
            if (forecastData === undefined)
                continue;

            let t_low = forecastData.temp.min;
            let t_high = forecastData.temp.max;

            switch (this._units) {
                case WeatherUnits.FAHRENHEIT:
                    t_low = this.toFahrenheit(t_low);
                    t_high = this.toFahrenheit(t_high);
                    break;

                case WeatherUnits.CELSIUS:
                    t_low = t_low.toFixed(this._decimal_places);
                    t_high = t_high.toFixed(this._decimal_places);
                    break;

                case WeatherUnits.KELVIN:
                    t_low = this.toKelvin(t_low);
                    t_high = this.toKelvin(t_high);
                    break;

                case WeatherUnits.RANKINE:
                    t_low = this.toRankine(t_low);
                    t_high = this.toRankine(t_high);
                    break;

                case WeatherUnits.REAUMUR:
                    t_low = this.toReaumur(t_low);
                    t_high = this.toReaumur(t_high);
                    break;

                case WeatherUnits.ROEMER:
                    t_low = this.toRoemer(t_low);
                    t_high = this.toRoemer(t_high);
                    break;

                case WeatherUnits.DELISLE:
                    t_low = this.toDelisle(t_low);
                    t_high = this.toDelisle(t_high);
                    break;

                case WeatherUnits.NEWTON:
                    t_low = this.toNewton(t_low);
                    t_high = this.toNewton(t_high);
                    break;
            }

            let comment = forecastData.weather[0].description;
            if (this._translate_condition)
                comment = this.get_weather_condition(forecastData.weather[0].id);

            let forecastDate = new Date(forecastData.dt * 1000);
            let dayLeft = Math.floor((forecastDate.getTime() - beginOfDay.getTime()) / 86400000);

            let date_string = _("Today");
            if (dayLeft == 1)
                date_string = _("Tomorrow");
            else if (dayLeft > 1)
                date_string = _("In %s days").replace("%s", dayLeft);
            else if (dayLeft == -1)
                date_string = _("Yesterday");
            else if (dayLeft < -1)
                date_string = _("%s days ago").replace("%s", -1 * dayLeft);

            forecastUi.Day.text = date_string + ' (' + this.get_locale_day(forecastDate.getDay()) + ')\n' + forecastDate.toLocaleDateString();
            forecastUi.Temperature.text = '\u2193 ' + parseFloat(t_low).toLocaleString() + ' ' + this.unit_to_unicode() + '    \u2191 ' + parseFloat(t_high).toLocaleString() + ' ' + this.unit_to_unicode();
            forecastUi.Summary.text = comment;
            forecastUi.Icon.icon_name = this.get_weather_icon_safely(forecastData.weather[0].id);
        }
    },

    refreshWeatherForecast: function() {

        if (!this.extractId(this._city)) {
            this.updateCities();
            return;
        }

        this.oldLocation = this.extractId(this._city);

        let params = {
            id: this.oldLocation,
            units: 'metric',
            cnt: '13'
        };
        if (this._appid)
            params.APPID = this._appid;

        this.load_json_async(WEATHER_URL_FORECAST, params, function(json) {
            if (json && (Number(json.cod) == 200)) {
                if (this.forecastWeatherCache != json.list)
                    this.forecastWeatherCache = json.list;

                this.parseWeatherForecast();
            } else {
                // we are connected, but get no (or no correct) data, so invalidate
                // the shown data and reload after 10 minutes (recommendded by openweathermap.org)
                this.rebuildFutureWeatherUi();
                this.reloadWeatherForecast(600);
            }
        });
        this.reloadWeatherForecast(this._refresh_interval_forecast);
    },

    reloadWeatherForecast: function(interval) {
        if (this._timeoutForecast) {
            Mainloop.source_remove(this._timeoutForecast);
        }
        this._timeoutForecast = Mainloop.timeout_add_seconds(interval, Lang.bind(this, function() {
            this.forecastWeatherCache = undefined;
            if (this._connected)
                this.parseWeatherForecast();
            else
                this.rebuildFutureWeatherUi();
            return true;
        }));
    },

    destroyCurrentWeather: function() {
        if (this._currentWeather.get_child() !== null)
            this._currentWeather.get_child().destroy();
    },

    destroyFutureWeather: function() {
        if (this._futureWeather.get_child() !== null)
            this._futureWeather.get_child().destroy();
    },

    rebuildCurrentWeatherUi: function() {
        this._weatherInfo.text = _('Loading current weather ...');
        this._weatherIcon.icon_name = 'view-refresh' + this.icon_type();

        this.destroyCurrentWeather();

        // This will hold the icon for the current weather
        this._currentWeatherIcon = new St.Icon({
            icon_size: 72,
            icon_name: 'view-refresh' + this.icon_type(),
            style_class: 'openweather-current-icon'
        });

        this._sunriseIcon = new St.Icon({
            icon_size: 15,
            icon_name: 'weather-clear' + this.icon_type(),
            style_class: 'openweather-sunrise-icon'
        });

        this._sunsetIcon = new St.Icon({
            icon_size: 15,
            icon_name: 'weather-clear-night' + this.icon_type(),
            style_class: 'openweather-sunset-icon'
        });

        this._buildIcon = new St.Icon({
            icon_size: 15,
            icon_name: 'view-refresh' + this.icon_type(),
            style_class: 'openweather-build-icon'
        });

        // The summary of the current weather
        this._currentWeatherSummary = new St.Label({
            text: _('Loading ...'),
            style_class: 'openweather-current-summary'
        });
        this._currentWeatherLocation = new St.Label({
            text: _('Please wait')
        });

        let bb = new St.BoxLayout({
            vertical: true,
            style_class: 'openweather-current-summarybox'
        });
        bb.add_actor(this._currentWeatherLocation);
        bb.add_actor(this._currentWeatherSummary);

        this._currentWeatherSunrise = new St.Label({
            text: '-'
        });
        this._currentWeatherSunset = new St.Label({
            text: '-'
        });
        this._currentWeatherBuild = new St.Label({
            text: '-'
        });

        let ab = new St.BoxLayout({
            style_class: 'openweather-current-infobox'
        });

        ab.add_actor(this._sunriseIcon);
        ab.add_actor(this._currentWeatherSunrise);
        ab.add_actor(this._sunsetIcon);
        ab.add_actor(this._currentWeatherSunset);
        ab.add_actor(this._buildIcon);
        ab.add_actor(this._currentWeatherBuild);
        bb.add_actor(ab);

        // Other labels
        this._currentWeatherTemperature = new St.Label({
            text: '...'
        });
        this._currentWeatherHumidity = new St.Label({
            text: '...'
        });
        this._currentWeatherPressure = new St.Label({
            text: '...'
        });
        this._currentWeatherWind = new St.Label({
            text: '...'
        });

        let rb = new St.BoxLayout({
            style_class: 'openweather-current-databox'
        });
        let rb_captions = new St.BoxLayout({
            vertical: true,
            style_class: 'openweather-current-databox-captions'
        });
        let rb_values = new St.BoxLayout({
            vertical: true,
            style_class: 'openweather-current-databox-values'
        });
        rb.add_actor(rb_captions);
        rb.add_actor(rb_values);

        rb_captions.add_actor(new St.Label({
            text: _('Cloudiness:')
        }));
        rb_values.add_actor(this._currentWeatherTemperature);
        rb_captions.add_actor(new St.Label({
            text: _('Humidity:')
        }));
        rb_values.add_actor(this._currentWeatherHumidity);
        rb_captions.add_actor(new St.Label({
            text: _('Pressure:')
        }));
        rb_values.add_actor(this._currentWeatherPressure);
        rb_captions.add_actor(new St.Label({
            text: _('Wind:')
        }));
        rb_values.add_actor(this._currentWeatherWind);

        let xb = new St.BoxLayout();
        xb.add_actor(bb);
        xb.add_actor(rb);

        let box = new St.BoxLayout({
            style_class: 'openweather-current-iconbox'
        });
        box.add_actor(this._currentWeatherIcon);
        box.add_actor(xb);
        this._currentWeather.set_child(box);
    },

    scrollForecastBy: function(delta) {
        if (this._forecastScrollBox === undefined)
            return;
        this._forecastScrollBox.hscroll.adjustment.value += delta;
    },

    rebuildFutureWeatherUi: function() {
        this.destroyFutureWeather();

        this._forecast = [];
        this._forecastBox = new St.BoxLayout({
            x_align: this._center_forecast ? St.Align.END : St.Align.START,
            style_class: 'openweather-forecast-box'
        });

        this._forecastScrollBox = new St.ScrollView({
            style_class: 'openweather-forecasts'
        });

        let pan = new Clutter.PanAction({
            interpolate: true
        });
        pan.connect('pan', Lang.bind(this, function(action) {

            let[dist, dx, dy] = action.get_motion_delta(0);

            this.scrollForecastBy(-1 * (dx / this._forecastScrollBox.width) * this._forecastScrollBox.hscroll.adjustment.page_size);
            return false;
        }));
        this._forecastScrollBox.add_action(pan);

        this._forecastScrollBox.connect('scroll-event', Lang.bind(this, this._onScroll));
        this._forecastScrollBox.hscroll.connect('scroll-event', Lang.bind(this, this._onScroll));

        this._forecastScrollBox.hscroll.margin_right = 25;
        this._forecastScrollBox.hscroll.margin_left = 25;
        this._forecastScrollBox.hscroll.hide();
        this._forecastScrollBox.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this._forecastScrollBox.hscrollbar_policy = Gtk.PolicyType.AUTOMATIC;
        this._forecastScrollBox.enable_mouse_scrolling = true;
        this._forecastScrollBox.hide();

        this._futureWeather.set_child(this._forecastScrollBox);

        for (let i = 0; i < this._days_forecast; i++) {
            let forecastWeather = {};

            forecastWeather.Icon = new St.Icon({
                icon_size: 48,
                icon_name: 'view-refresh' + this.icon_type(),
                style_class: 'openweather-forecast-icon'
            });
            forecastWeather.Day = new St.Label({
                style_class: 'openweather-forecast-day'
            });
            forecastWeather.Summary = new St.Label({
                style_class: 'openweather-forecast-summary'
            });
            forecastWeather.Temperature = new St.Label({
                style_class: 'openweather-forecast-temperature'
            });

            let by = new St.BoxLayout({
                vertical: true,
                style_class: 'openweather-forecast-databox'
            });
            by.add_actor(forecastWeather.Day);
            by.add_actor(forecastWeather.Summary);
            by.add_actor(forecastWeather.Temperature);

            let bb = new St.BoxLayout({
                style_class: 'openweather-forecast-iconbox'
            });
            bb.add_actor(forecastWeather.Icon);
            bb.add_actor(by);

            this._forecast[i] = forecastWeather;
            this._forecastBox.add_actor(bb);
        }
        this._forecastScrollBox.add_actor(this._forecastBox);
    },

    _onScroll: function(actor, event) {
        let dx = 0;
        let dy = 0;
        switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
                dy = -1;
                break;
            case Clutter.ScrollDirection.DOWN:
                dy = 1;
                break;
                // horizontal scrolling will be handled by the control itself
            default:
                return true;
        }

        this.scrollForecastBy(dy * this._forecastScrollBox.hscroll.adjustment.stepIncrement);
        return false;
    }
});

let openweatherMenu;

function init() {
    Convenience.initTranslations('gnome-shell-extension-openweather');
}

function enable() {
    openweatherMenu = new OpenweatherMenuButton();
    Main.panel.addToStatusArea('openweatherMenu', openweatherMenu);
}

function disable() {
    openweatherMenu.stop();
    openweatherMenu.destroy();
}