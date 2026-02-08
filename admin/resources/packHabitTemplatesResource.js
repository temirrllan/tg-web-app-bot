// admin/resources/packHabitTemplatesResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_habit_templates',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'Template',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      title_private: {
        isRequired: true,
        type: 'string',
        description: 'Template name (not shown to users)',
      },
      goal: {
        isRequired: true,
        type: 'textarea',
        description: 'Habit goal',
      },
      category_id: {
        type: 'reference',
        reference: 'categories',
        description: 'Category',
      },
      schedule_type: {
        type: 'string',
        availableValues: [
          { value: 'daily', label: 'Daily' },
          { value: 'weekdays', label: 'Weekdays' },
          { value: 'weekend', label: 'Weekend' },
          { value: 'custom', label: 'Custom' },
        ],
      },
      schedule_days: {
        type: 'mixed',
        description: 'Days array [1-7] (Monday=1, Sunday=7)',
        components: {
          edit: 'textarea',
          list: 'string',
        },
      },
      reminder_time: {
        type: 'string',
        description: 'Reminder time (HH:MM:SS)',
      },
      reminder_enabled: {
        type: 'boolean',
      },
      is_bad_habit: {
        type: 'boolean',
      },
      is_active: {
        type: 'boolean',
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false },
      },
    },
    listProperties: [
      'id',
      'title_private',
      'category_id',
      'schedule_type',
      'reminder_time',
      'is_active',
    ],
    editProperties: [
      'title_private',
      'goal',
      'category_id',
      'schedule_type',
      'schedule_days',
      'reminder_time',
      'reminder_enabled',
      'is_bad_habit',
      'is_active',
    ],
  },
};