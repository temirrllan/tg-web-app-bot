export class ResourceMetadata {
    dialect;
    knex;
    database;
    schemaName;
    tableName;
    properties;
    idProperty;
    constructor(dialect, knex, database, schemaName, tableName, properties) {
        this.dialect = dialect;
        this.knex = knex;
        this.database = database;
        this.schemaName = schemaName;
        this.tableName = tableName;
        this.properties = properties;
        const idProperty = properties.find((p) => p?.isId?.());
        if (!idProperty) {
            throw new Error(`Table "${tableName}" has no primary key`);
        }
        this.idProperty = idProperty;
        this.dialect = dialect;
    }
}
//# sourceMappingURL=ResourceMetadata.js.map