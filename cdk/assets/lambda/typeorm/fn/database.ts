import {
  Connection,
  ConnectionManager,
  ConnectionOptions,
  createConnection,
  getConnectionManager
} from "typeorm";

/**
 * Database manager class
 */
export class Database {
  private connectionManager: ConnectionManager;

  constructor() {
    this.connectionManager = getConnectionManager();
  }

  public async getConnection(): Promise<Connection> {
    const CONNECTION_NAME = `default`;

    let connection: Connection;

    if (this.connectionManager.has(CONNECTION_NAME)) {
      console.info(`Database.getConnection()-using existing connection ...`);
      connection = await this.connectionManager.get(CONNECTION_NAME);

      if (!connection.isConnected) {
        connection = await connection.connect();
      }
    } else {
      console.info(`Database.getConnection()-creating connection ...`);

      const connectionOptions: ConnectionOptions = {
        name: `default`,
        type: `mysql`,
        port: 3306,
        synchronize: true,
        logging: true,
        host: process.env.host,
        username: process.env.username,
        database: process.env.database,
        password: process.env.password,
        entities: [ __dirname + "/models/*.js" ],
        connectTimeout: 25000
      };

      console.log({
        host: process.env.host,
        database: process.env.database,
        username: process.env.username,
        password: process.env.password
      });

      connection = await createConnection(connectionOptions);
    }

    return connection;
  }
}
