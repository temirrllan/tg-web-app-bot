// В начале файла добавьте импорты
const storePacksResource = require('./resources/storePacksResource');
const packHabitTemplatesResource = require('./resources/packHabitTemplatesResource');
const packItemsResource = require('./resources/packItemsResource');
const packAchievementLevelsResource = require('./resources/packAchievementLevelsResource');
const packPurchasesResource = require('./resources/packPurchasesResource');
const packOrdersResource = require('./resources/packOrdersResource');

// Найдите массив resources и добавьте:
const resources = [
  // ... существующие ресурсы ...
  
  // Пакеты
  {
    ...storePacksResource,
    resource: {
      ...storePacksResource.resource,
      client: db
    }
  },
  {
    ...packHabitTemplatesResource,
    resource: {
      ...packHabitTemplatesResource.resource,
      client: db
    }
  },
  {
    ...packItemsResource,
    resource: {
      ...packItemsResource.resource,
      client: db
    }
  },
  {
    ...packAchievementLevelsResource,
    resource: {
      ...packAchievementLevelsResource.resource,
      client: db
    }
  },
  {
    ...packPurchasesResource,
    resource: {
      ...packPurchasesResource.resource,
      client: db
    }
  },
  {
    ...packOrdersResource,
    resource: {
      ...packOrdersResource.resource,
      client: db
    }
  }
];