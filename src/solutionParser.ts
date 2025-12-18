import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    name: string;
    path: string;
    assemblyName: string;
    outputType: string;
}

/**
 * Parse a .sln file and extract all project paths
 */
export function parseSolution(slnPath: string): string[] {
    const content = fs.readFileSync(slnPath, 'utf-8');
    const projectPattern = /Project\("[^"]+"\)\s*=\s*"[^"]+",\s*"([^"]+\.csproj)"/gi;
    const projects: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = projectPattern.exec(content)) !== null) {
        const projectRelPath = match[1].replace(/\\/g, '/');
        const projectAbsPath = path.resolve(path.dirname(slnPath), projectRelPath);
        if (fs.existsSync(projectAbsPath)) {
            projects.push(projectAbsPath);
        }
    }

    return projects;
}

/**
 * Parse a .csproj file and extract project info
 */
export function parseProject(csprojPath: string): ProjectInfo {
    const content = fs.readFileSync(csprojPath, 'utf-8');
    const name = path.basename(csprojPath, '.csproj');

    // Extract AssemblyName, default to project name
    const assemblyNameMatch = content.match(/<AssemblyName>([^<]+)<\/AssemblyName>/i);
    const assemblyName = assemblyNameMatch ? assemblyNameMatch[1] : name;

    // Extract OutputType, default to Exe
    const outputTypeMatch = content.match(/<OutputType>([^<]+)<\/OutputType>/i);
    const outputType = outputTypeMatch ? outputTypeMatch[1] : 'Library';

    return {
        name,
        path: csprojPath,
        assemblyName,
        outputType
    };
}

/**
 * Find .sln file in the given directory
 */
export function findSolution(workspacePath: string): string | null {
    const files = fs.readdirSync(workspacePath);
    const slnFile = files.find(f => f.endsWith('.sln'));
    return slnFile ? path.join(workspacePath, slnFile) : null;
}

/**
 * Get all executable projects from a solution
 */
export function getExecutableProjects(slnPath: string): ProjectInfo[] {
    const projectPaths = parseSolution(slnPath);
    // 返回所有项目类型（不只是 Exe）
    return projectPaths.map(p => parseProject(p));
}
