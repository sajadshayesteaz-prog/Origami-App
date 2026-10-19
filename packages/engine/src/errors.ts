/** An action that cannot be carried out; the message is meant for the person writing the script. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
