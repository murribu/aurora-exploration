import "reflect-metadata";
import { Connection } from "typeorm";
import { Item } from "./models/Item";
import { Database } from "./database";

exports.lambdaHandler = async (
  event: any,
  context: any,
  callback: Function
) => {
  console.log(event);

  const database = new Database();

  let dbConn: Connection = await database.getConnection();

  const item = await dbConn.getRepository(Item).find();

  callback(null, item);
};
