import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as crypto from 'crypto';
import Client from 'ssh2-sftp-client';
import { Client as SSHClient } from 'ssh2';

export interface DeployConfig {
    host: string;
    port: number;
    username: string;
    authType: 'key' | 'password';
    privateKeyPath?: string;
    password?: string;
    remotePath: string;
    afterUploadCommand?: string;
    telegramEnabled?: boolean;
    telegramUpload?: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
    incrementalUpload?: boolean;  // 增量上传：只上传有变化的文件
}

export interface DeployResult {
    success: boolean;
    error?: string;
}

/**
 * Expand ~ to home directory
 */
function expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

/**
 * Deploy published files to remote server via SFTP
 */
export async function deploy(
    config: DeployConfig,
    localPath: string,
    assemblyName: string,
    outputChannel: vscode.OutputChannel
): Promise<DeployResult> {
    const sftp = new Client();

    try {
        const connectConfig: any = {
            host: config.host,
            port: config.port,
            username: config.username
        };

        if (config.authType === 'password') {
            connectConfig.password = config.password;
        } else {
            const keyPath = expandPath(config.privateKeyPath || '');
            if (!fs.existsSync(keyPath)) {
                throw new Error(`Private key not found: ${keyPath}`);
            }
            connectConfig.privateKey = fs.readFileSync(keyPath, 'utf-8');
        }

        outputChannel.appendLine(`[Deployer] Connecting to ${config.host}:${config.port} via ${config.authType}...`);

        // Connect
        await sftp.connect(connectConfig);

        outputChannel.appendLine(`[Deployer] ✓ Connected`);

        // Create remote directory
        const remoteDir = path.posix.join(config.remotePath, assemblyName);

        try {
            await sftp.mkdir(remoteDir, true);
            outputChannel.appendLine(`[Deployer] ✓ Created remote directory: ${remoteDir}`);
        } catch (err: any) {
            // Directory might already exist
            if (!err.message.includes('already exists')) {
                outputChannel.appendLine(`[Deployer] Directory exists or created: ${remoteDir}`);
            }
        }

        // Get all files to upload
        const files = getAllFiles(localPath);

        // 增量上传逻辑
        let filesToUpload: string[] = files;
        let skipped = 0;

        if (config.incrementalUpload) {
            outputChannel.appendLine(`[Deployer] Incremental upload enabled, checking for changes...`);
            filesToUpload = [];

            for (const file of files) {
                const relativePath = path.relative(localPath, file);
                const remoteFilePath = path.posix.join(remoteDir, relativePath.replace(/\\/g, '/'));

                const needsUpload = await shouldUploadFile(sftp, file, remoteFilePath);
                if (needsUpload) {
                    filesToUpload.push(file);
                } else {
                    skipped++;
                }
            }

            outputChannel.appendLine(`[Deployer] Incremental: ${filesToUpload.length} files to upload, ${skipped} files unchanged`);
        }

        if (filesToUpload.length === 0) {
            outputChannel.appendLine(`[Deployer] ✓ All files are up to date, nothing to upload`);
        } else {
            outputChannel.appendLine(`[Deployer] Uploading ${filesToUpload.length} files...`);
        }

        let uploaded = 0;
        for (const file of filesToUpload) {
            const relativePath = path.relative(localPath, file);
            const remotePath = path.posix.join(remoteDir, relativePath.replace(/\\/g, '/'));
            const remoteFileDir = path.posix.dirname(remotePath);

            // Ensure remote directory exists
            try {
                await sftp.mkdir(remoteFileDir, true);
            } catch {
                // Ignore if exists
            }

            // Upload file
            await sftp.put(file, remotePath);
            uploaded++;

            // Progress update every 10 files
            if (uploaded % 10 === 0 || uploaded === filesToUpload.length) {
                outputChannel.appendLine(`[Deployer] Progress: ${uploaded}/${filesToUpload.length} files`);
            }
        }

        // Make executable file executable
        const executablePath = path.posix.join(remoteDir, assemblyName);
        await sftp.chmod(executablePath, 0o755);
        outputChannel.appendLine(`[Deployer] ✓ Set executable permissions on ${assemblyName}`);

        await sftp.end();
        outputChannel.appendLine(`[Deployer] ✓ Upload complete`);

        // Send success notification
        if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
            await sendTelegramNotification(
                config.telegramBotToken,
                config.telegramChatId,
                `✅ *Deploy Successful*\n\nProject: \`${assemblyName}\`\nHost: \`${config.host}\`\nPath: \`${config.remotePath}/${assemblyName}\``,
                outputChannel
            );

            // Upload artifact if enabled
            if (config.telegramUpload) {
                // Find the main executable or single file
                // In single file publish, it's just assemblyName (no extension on Linux)
                const artifactPath = path.join(localPath, assemblyName);
                if (fs.existsSync(artifactPath)) {
                    await sendTelegramDocument(
                        config.telegramBotToken,
                        config.telegramChatId,
                        artifactPath,
                        outputChannel
                    );
                } else {
                    // Try with .exe for windows cross compile? Or just zip?
                    // For now, assume single file artifact
                    outputChannel.appendLine(`[Telegram] Artifact not found at ${artifactPath}, skipping upload.`);
                }
            }
        }

        return { success: true };

    } catch (err: any) {
        // Send failure notification
        if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
            await sendTelegramNotification(
                config.telegramBotToken,
                config.telegramChatId,
                `❌ *Deploy Failed*\n\nProject: \`${assemblyName}\`\nHost: \`${config.host}\`\nError: ${err.message}`,
                outputChannel
            );
        }
        outputChannel.appendLine(`[Deployer] ✗ Error: ${err.message}`);
        try {
            await sftp.end();
        } catch {
            // Ignore close errors
        }
        return { success: false, error: err.message };
    }
}

/**
 * Get all files in directory recursively
 */
function getAllFiles(dirPath: string, files: string[] = []): string[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            getAllFiles(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }

    return files;
}

/**
 * Calculate MD5 hash of a file
 */
function calculateFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

/**
 * Check if a file needs to be uploaded by comparing size and modification time
 * Returns true if file should be uploaded, false if it can be skipped
 */
async function shouldUploadFile(sftp: Client, localFile: string, remoteFile: string): Promise<boolean> {
    try {
        // Get local file stats
        const localStats = fs.statSync(localFile);

        // Try to get remote file stats
        let remoteStat;
        try {
            remoteStat = await sftp.stat(remoteFile);
        } catch {
            // Remote file doesn't exist, need to upload
            return true;
        }

        // Compare file sizes - if different, need to upload
        if (localStats.size !== remoteStat.size) {
            return true;
        }

        // Compare modification times - if local is newer, need to upload
        // Remote mtime is in seconds, local is in milliseconds
        const localMtime = Math.floor(localStats.mtimeMs / 1000);
        const remoteMtime = remoteStat.modifyTime;

        if (localMtime > remoteMtime) {
            return true;
        }

        // Files appear to be the same
        return false;
    } catch {
        // On any error, upload the file to be safe
        return true;
    }
}

/**
 * Execute remote command via SSH
 */
export async function executeRemote(
    config: DeployConfig,
    assemblyName: string,
    outputChannel: vscode.OutputChannel
): Promise<DeployResult> {

    return new Promise((resolve) => {
        const client = new SSHClient();
        const connectConfig: any = {
            host: config.host,
            port: config.port,
            username: config.username
        };

        if (config.authType === 'password') {
            connectConfig.password = config.password;
        } else {
            const keyPath = expandPath(config.privateKeyPath || '');
            if (!fs.existsSync(keyPath)) {
                resolve({ success: false, error: `Private key not found: ${keyPath}` });
                return;
            }
            connectConfig.privateKey = fs.readFileSync(keyPath, 'utf-8');
        }

        client.on('ready', () => {
            const remoteExe = path.posix.join(config.remotePath, assemblyName, assemblyName);
            let command = config.afterUploadCommand || 'sudo {remote_path}/{app_name} start';

            // Variable substitution
            command = command.replace(/{app_name}/g, assemblyName)
                .replace(/{remote_path}/g, path.posix.join(config.remotePath, assemblyName))
                .replace(/{app_path}/g, remoteExe);

            outputChannel.appendLine(`[Runner] Executing: ${command}`);

            client.exec(command, { pty: true }, (err, stream) => {
                if (err) {
                    client.end();
                    resolve({ success: false, error: err.message });
                    return;
                }

                let output = '';

                stream.on('close', (code: number) => {
                    client.end();
                    if (code === 0) {
                        outputChannel.appendLine(`[Runner] ✓ Service started successfully`);
                        resolve({ success: true });
                    } else {
                        outputChannel.appendLine(`[Runner] ✗ Command exited with code ${code}`);
                        resolve({ success: false, error: `Exit code: ${code}` });
                    }
                });

                stream.on('data', (data: Buffer) => {
                    const text = data.toString();
                    output += text;
                    outputChannel.append(text);
                });

                stream.stderr.on('data', (data: Buffer) => {
                    const text = data.toString();
                    output += text;
                    outputChannel.append(text);
                });
            });
        });

        client.on('error', (err) => {
            outputChannel.appendLine(`[Runner] ✗ SSH Error: ${err.message}`);
            resolve({ success: false, error: err.message });
        });

        try {
            client.connect(connectConfig);
        } catch (err: any) {
            resolve({ success: false, error: err.message });
        }
    });
}

async function sendTelegramNotification(token: string, chatId: string, message: string, outputChannel: vscode.OutputChannel) {
    return new Promise<void>((resolve) => {
        const postData = JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 200) {
                outputChannel.appendLine('[Telegram] Notification sent');
            } else {
                outputChannel.appendLine(`[Telegram] Failed to send notification: ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            outputChannel.appendLine(`[Telegram] Error sending notification: ${e.message}`);
            resolve();
        });

        req.write(postData);
        req.end();
    });
}

async function sendTelegramDocument(token: string, chatId: string, filePath: string, outputChannel: vscode.OutputChannel) {
    return new Promise<void>((resolve) => {
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;
        // 50MB limit check
        if (fileSizeInBytes > 50 * 1024 * 1024) {
            outputChannel.appendLine(`[Telegram] File too large to upload (${(fileSizeInBytes / 1024 / 1024).toFixed(2)}MB). Limit is 50MB.`);
            resolve();
            return;
        }

        const fileName = path.basename(filePath);
        const boundary = '----VSCodeDotnetDeployBoundary' + Date.now();

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${token}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 200) {
                outputChannel.appendLine(`[Telegram] Artifact uploaded: ${fileName}`);
            } else {
                outputChannel.appendLine(`[Telegram] Failed to upload artifact: ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            outputChannel.appendLine(`[Telegram] Error uploading artifact: ${e.message}`);
            resolve();
        });

        // Construct multipart body
        req.write(`--${boundary}\r\n`);
        req.write(`Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);

        req.write(`--${boundary}\r\n`);
        req.write(`Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n`);
        req.write(`Content-Type: application/octet-stream\r\n\r\n`);

        // Stream file
        const fileStream = fs.createReadStream(filePath);
        fileStream.on('end', () => {
            req.write(`\r\n--${boundary}--\r\n`);
            req.end();
        });
        fileStream.pipe(req, { end: false });
    });
}
