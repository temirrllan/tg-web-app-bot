// services/maintenanceService.js
// In-memory maintenance mode flag (resets on server restart = safe)

let maintenanceMode = false;

module.exports = {
  isEnabled() {
    return maintenanceMode;
  },

  enable() {
    maintenanceMode = true;
    console.log('🔧 Maintenance mode ENABLED');
  },

  disable() {
    maintenanceMode = false;
    console.log('✅ Maintenance mode DISABLED');
  },

  toggle() {
    maintenanceMode = !maintenanceMode;
    console.log(`🔧 Maintenance mode ${maintenanceMode ? 'ENABLED' : 'DISABLED'}`);
    return maintenanceMode;
  }
};
