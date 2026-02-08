// admin/index.js - Главный файл AdminJS

const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const AdminJSPostgresql = require('@adminjs/postgresql');
const express = require('express');
const session = require('express-session');
const db = require('../config/database');

// Ресурсы (модели)
const storePacksResource = require('./resources/storePacksResource');
const packHabitTemplatesResource = require('./resources/packHabitTemplatesResource');
const packItemsResource = require('./resources/packItemsResource');
const packAchievementLevelsResource = require('./resources/packAchievementLevelsResource');
const packPurchasesResource = require('./resources/packPurchasesResource');
const packOrdersResource = require('./resources/packOrdersResource');
const packInstallationsResource = require('./resources/packInstallationsResource');
const userPackAchievementsResource = require('./resources/userPackAchievementsResource');

// Регистрируем адаптер PostgreSQL
AdminJS.registerAdapter({
  Resource: AdminJSPostgresql.Resource,
  Database: AdminJSPostgresql.Database,
});

// Конфигурация AdminJS
const adminOptions = {
  resources: [
    storePacksResource,
    packHabitTemplatesResource,
    packItemsResource,
    packAchievementLevelsResource,
    packPurchasesResource,
    packOrdersResource,
    packInstallationsResource,
    userPackAchievementsResource,
  ],
  rootPath: '/admin',
  branding: {
    companyName: 'Habit Tracker Admin',
    logo: false,
    withMadeWithLove: false,
    favicon: 'https://app.eventmate.asia/favicon.ico',
  },
  locale: {
    language: 'en',
    translations: {
      en: {
        labels: {
          store_packs: 'Store Packs',
          pack_habit_templates: 'Habit Templates',
          pack_items: 'Pack Items',
          pack_achievement_levels: 'Achievement Levels',
          pack_purchases: 'Purchases',
          pack_orders: 'Orders',
          pack_installations: 'Installations',
          user_pack_achievements: 'User Achievements',
        },
      },
    },
  },
};

const admin = new AdminJS(adminOptions);

// Простая аутентификация (для production используйте более безопасную)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@habittracker.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
  admin,
  {
    authenticate: async (email, password) => {
      if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        return { email: ADMIN_EMAIL };
      }
      return null;
    },
    cookieName: 'adminjs',
    cookiePassword: process.env.ADMIN_COOKIE_SECRET || 'some-secret-password-that-is-at-least-32-characters-long',
  },
  null,
  {
    secret: process.env.SESSION_SECRET || 'some-secret-session-key-that-is-at-least-32-characters-long',
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  }
);

module.exports = { admin, adminRouter };