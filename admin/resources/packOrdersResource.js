// admin/resources/packOrdersResource.js - Заказы на покупку пакетов

const packOrdersResource = {
  resource: {
    model: 'pack_orders',
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
      user_id: {
        type: 'reference',
        reference: 'users',
        isRequired: true
      },
      pack_id: {
        type: 'reference',
        reference: 'store_packs',
        isRequired: true
      },
      amount_stars: {
        type: 'number',
        isRequired: true
      },
      status: {
        type: 'string',
        availableValues: [
          { value: 'CREATED', label: 'Создан' },
          { value: 'PENDING', label: 'Ожидание оплаты' },
          { value: 'PAID', label: 'Оплачен' },
          { value: 'FAILED', label: 'Ошибка' },
          { value: 'REFUNDED', label: 'Возврат' }
        ],
        isRequired: true
      },
      provider: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      },
      provider_invoice_id: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      },
      provider_payment_id: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      },
      created_at: {
        isVisible: { list: true, filter: false, show: true, edit: false }
      },
      paid_at: {
        isVisible: { list: true, filter: false, show: true, edit: false }
      }
    },
    listProperties: ['id', 'user_id', 'pack_id', 'amount_stars', 'status', 'created_at', 'paid_at'],
    filterProperties: ['user_id', 'pack_id', 'status'],
    showProperties: ['id', 'user_id', 'pack_id', 'amount_stars', 'status', 'provider', 'provider_invoice_id', 'provider_payment_id', 'created_at', 'paid_at'],
    editProperties: [] // Только для просмотра, редактирование запрещено
  }
};

module.exports = packOrdersResource;