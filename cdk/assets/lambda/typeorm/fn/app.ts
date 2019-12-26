import "reflect-metadata";
import { Connection, createConnection } from "typeorm";
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

  let item;
  try {
    const itemRepository = dbConn.getRepository(Item);

    const newItem = new Item();
    newItem.name = "Timber";
    newItem.description = "Saw";
    newItem.isPublished = false;
    await itemRepository.save(newItem);
    item = await dbConn.getRepository(Item).findOne({ id: 1 });
    console.log({ item: JSON.stringify(item) });
  } catch (err) {
    item = "nope";
    console.error(err);
  }

  return item;
};
