// admin/resources/packHabitTemplatesResource.js - Шаблоны привычек для пакетов

const packHabitTemplatesResource = {
  resource: {
    model: 'pack_habit_templates',
    client: null
  },
  options: {
    navigation: {
      name: '📦 Пакеты',
      icon: 'Package'
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false }
      },
      title_private: {
        isTitle: true,
        isRequired: true,
        description: 'Название привычки (будет показано после покупки)'
      },
      goal: {
        type: 'textarea',
        isRequired: true,
        description: 'Описание цели привычки'
      },
      category_id: {
        type: 'reference',
        reference: 'categories',
        description: 'Категория привычки'
      },
      schedule_type: {
        type: 'string',
        availableValues: [
          { value: 'daily', label: 'Ежедневно' },
          { value: 'weekly', label: 'По дням недели' },
          { value: 'custom', label: 'Кастомный' }
        ],
        description: 'Тип расписания'
      },
      schedule_days: {
        type: 'mixed',
        description: 'Дни недели (массив 1-7, где 1=ПН, 7=ВС)'
      },
      reminder_time: {
        type: 'string',
        description: 'Время напоминания (HH:MM:SS)'
      },
      reminder_enabled: {
        type: 'boolean',
        description: 'Включить напоминания'
      },
      is_bad_habit: {
        type: 'boolean',
        description: 'Вредная привычка (обратная логика)'
      },
      is_active: {
        type: 'boolean',
        isRequired: true,
        description: 'Активен'
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      }
    },
    listProperties: ['id', 'title_private', 'category_id', 'schedule_type', 'is_active'],
    filterProperties: ['title_private', 'category_id', 'is_active'],
    showProperties: ['id', 'title_private', 'goal', 'category_id', 'schedule_type', 'schedule_days', 'reminder_time', 'reminder_enabled', 'is_bad_habit', 'is_active', 'created_at'],
    editProperties: ['title_private', 'goal', 'category_id', 'schedule_type', 'schedule_days', 'reminder_time', 'reminder_enabled', 'is_bad_habit', 'is_active']
  }
};

module.exports = packHabitTemplatesResource;