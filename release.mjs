#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  try {
    // Get current version
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const currentVersion = packageJson.version;
    
    console.log(`Current version: ${currentVersion}`);
    console.log("Examples: 1.0.1 (patch), 1.1.0 (minor), 2.0.0 (major)");
    
    const newVersion = await question("Enter new version: ");
    
    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
      throw new Error("Invalid version format. Use x.y.z (e.g., 1.0.1)");
    }
    
    console.log(`\nReleasing version ${newVersion}...`);
    
    // Update package.json
    packageJson.version = newVersion;
    writeFileSync("package.json", JSON.stringify(packageJson, null, "\t"));
    console.log("✓ Updated package.json");
    
    // Update manifest.json
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    manifest.version = newVersion;
    writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
    console.log("✓ Updated manifest.json");
    
    // Update versions.json
    const versions = JSON.parse(readFileSync("versions.json", "utf8"));
    versions[newVersion] = manifest.minAppVersion;
    writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
    console.log("✓ Updated versions.json");
    
    // Build the plugin
    console.log("\nBuilding plugin...");
    execSync("npm run build", { stdio: "inherit" });
    console.log("✓ Plugin built successfully");
    
    // Check if there are changes to commit
    try {
      execSync("git diff --quiet", { stdio: "pipe" });
      console.log("No changes to commit.");
    } catch {
      // There are changes, commit them (don't add main.js - it's built by GitHub Actions)
      execSync("git add package.json manifest.json versions.json", { stdio: "inherit" });
      execSync(`git commit -m "Release version ${newVersion}"`, { stdio: "inherit" });
      console.log("✓ Changes committed");
    }
    
    // Create and push tag
    console.log(`\nCreating tag ${newVersion}...`);
    execSync(`git tag ${newVersion}`, { stdio: "inherit" });
    console.log("✓ Tag created");
    
    console.log("Pushing to GitHub...");
    execSync(`git push origin master`, { stdio: "inherit" });
    execSync(`git push origin ${newVersion}`, { stdio: "inherit" });
    console.log("✓ Pushed to GitHub");
    
    console.log(`\n🎉 Release ${newVersion} initiated!`);
    console.log("GitHub Actions will build and create the release automatically.");
    console.log(`Check: https://github.com/RandyBoBandy92/claude-code-bridge/releases`);
    
  } catch (error) {
    console.error("❌ Release failed:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();