import { store } from "../lib/bootstrap.mjs";

try {
  if (process.argv[2] === "pair" && process.argv.length === 3 && process.stdout.isTTY) {
    process.stdout.write(await store.rotateToken() + "\n");
  } else if (process.argv[2] === "reset-password" && process.argv.length === 3 && !process.stdin.isTTY) {
    let password = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      password += chunk;
      if (password.length > 130) throw new Error("Password must contain 12 to 128 characters.");
    }
    password = password.replace(/\r?\n$/, "");
    if (password.length < 12 || password.length > 128) throw new Error("Password must contain 12 to 128 characters.");
    await store.resetPassword(password);
    console.log("Administrator password reset and sessions revoked.");
  } else {
    throw new Error("Use pair in a private container terminal, or pipe a password into reset-password.");
  }
} catch (error) {
  console.error(error.code ? "Operator command failed. Check data storage permissions." : error.message);
  process.exitCode = 1;
}
