export class DatabaseMetadata {
    database;
    resourceMap;
    constructor(database, resourceMap) {
        this.database = database;
        this.resourceMap = resourceMap;
    }
    tables() {
        return Array.from(this.resourceMap.values());
    }
    table(tableName) {
        const resource = this.resourceMap.get(tableName);
        if (!resource) {
            throw new Error(`Table does not exist: "${this.database}.${tableName}"`);
        }
        return resource;
    }
}
//# sourceMappingURL=DatabaseMetadata.js.map