import fs from 'fs/promises';

import type { TextEditor } from 'vscode';
import vscode from 'vscode';

import { NodeVersionCodeLensProvider } from './codeLens/nodeVersion';
import { PackageJsonDependenciesCodeLensProvider } from './codeLens/packageJsonDependencies';
import { PackageJsonFilesCodeLensProvider } from './codeLens/packageJsonFiles';
import { PackageJsonVersionCodeLensProvider } from './codeLens/packageJsonVersion';
import { PnpmWorkspaceCodeLensProvider } from './codeLens/pnpmWorkspace';
import { NpmrcCompletionItemProvider } from './completion/npmrc';
import { updateConfiguration } from './configuration';
import { DependenciesDefinitionProvider } from './definitions/dependencies';
import { disposeCodeActionsProviders, registerCodeActionsProviders } from './diagnostic';
import { DependenciesHoverProvider } from './hoverTooltips/dependencies';
import { ModulesHoverProvider } from './hoverTooltips/modules';
import { NpmScriptsHoverProvider } from './hoverTooltips/npmScripts';
import { logger } from './logger';
import type { Command } from './utils/constants';
import { commands, EXT_NAME, npmrcSelector, pkgJsonSelector } from './utils/constants';
import { pathExists } from './utils/fs';
import { store } from './utils/store';

export function activate(context: vscode.ExtensionContext) {
    const { storageUri, subscriptions } = context;

    const storageDir = storageUri!.fsPath;
    store.storageDir = storageDir;
    (async function () {
        if (!(await pathExists(storageDir))) {
            await fs.mkdir(storageDir);
        }
    })();

    vscode.workspace.onDidChangeConfiguration(
        async (event) => {
            if (event.affectsConfiguration(EXT_NAME)) {
                await updateConfiguration();
            }
        },
        null,
        subscriptions,
    );

    const registerCommand = (
        command: Command,
        callback: (...args: any[]) => any,
        thisArg?: any,
    ) => {
        const cmd = vscode.commands.registerCommand(command, callback, thisArg);
        context.subscriptions.push(cmd);
        return cmd;
    };

    const registerTextEditorCommand = (
        command: Command,
        callback: (editor: TextEditor) => any,
        thisArg?: any,
    ) => {
        const cmd = vscode.commands.registerTextEditorCommand(command, callback, thisArg);
        context.subscriptions.push(cmd);
        return cmd;
    };

    registerCommand(commands.showReferencesInPanel, (...args: any[]) =>
        import('./commands/showReferencesInPanel').then((mod) =>
            (mod.showReferencesInPanel as any)(...args),
        ),
    );
    registerCommand(commands.removeUnusedDependency, (...args: any[]) =>
        import('./commands/removeUnusedDependency').then((mod) =>
            (mod.removeUnusedDependency as any)(...args),
        ),
    );
    registerCommand(commands.showPackageJsonDependenciesCodeLens, () =>
        import('./commands/togglePackageJsonDependenciesCodeLens').then((mod) =>
            mod.togglePackageJsonDependenciesCodeLens(),
        ),
    );

    registerCommand(commands.hidePackageJsonDependenciesCodeLens, () =>
        import('./commands/togglePackageJsonDependenciesCodeLens').then((mod) =>
            mod.togglePackageJsonDependenciesCodeLens(),
        ),
    );

    registerCommand(commands.runNpmScriptBackground, (...args: any[]) =>
        import('./commands/runNpmScriptBackground').then((mod) =>
            (mod.runNpmScriptBackground as any)(...args),
        ),
    );

    registerCommand(commands.runNpmScriptInTerminal, (...args: any[]) =>
        import('./commands/runNpmScriptInTerminal').then((mod) =>
            (mod.runNpmScriptInTerminal as any)(...args),
        ),
    );

    registerTextEditorCommand(commands.addMissingDeps, (editor) =>
        import('./commands/addMissingDeps').then((mod) => mod.addMissingDeps(editor)),
    );

    registerCommand(commands.findNpmPackage, (uri) =>
        import('./commands/findNpmPackage').then((mod) => mod.findNpmPackage(uri)),
    );

    registerCommand(commands.findPathInNodeModules, (uri) =>
        import('./commands/findPathInNodeModules').then((mod) => mod.findPathInNodeModules(uri)),
    );

    subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            {
                language: 'yaml',
                scheme: 'file',
                pattern: '**/pnpm-workspace.yaml',
            },
            new PnpmWorkspaceCodeLensProvider(context),
        ),
        vscode.languages.registerCodeLensProvider(
            pkgJsonSelector,
            new PackageJsonFilesCodeLensProvider(context),
        ),
        vscode.languages.registerCodeLensProvider(
            pkgJsonSelector,
            new PackageJsonDependenciesCodeLensProvider(context),
        ),
        vscode.languages.registerCodeLensProvider(
            pkgJsonSelector,
            new PackageJsonVersionCodeLensProvider(context),
        ),
        vscode.languages.registerCodeLensProvider(
            {
                // language: 'plaintext',
                scheme: 'file',
                pattern: '**/{.nvmrc,.node-version}',
            },
            new NodeVersionCodeLensProvider(context),
        ),
        vscode.languages.registerHoverProvider(pkgJsonSelector, new NpmScriptsHoverProvider()),
        vscode.languages.registerHoverProvider(pkgJsonSelector, new DependenciesHoverProvider()),
        vscode.languages.registerHoverProvider(
            [
                'javascript',
                'typescript',
                'javascriptreact',
                'typescriptreact',
                'vue',
                'astro',
                'svelte',
                'mdx',
                'html',
            ],
            new ModulesHoverProvider(),
        ),
        vscode.languages.registerDefinitionProvider(
            pkgJsonSelector,
            new DependenciesDefinitionProvider(),
        ),
        vscode.languages.registerCompletionItemProvider(
            npmrcSelector,
            new NpmrcCompletionItemProvider(),
        ),
    );

    registerCommand(commands.replaceDocument, (...args: any[]) =>
        import('./commands/replaceDocument').then((mod) =>
            mod.replaceDocument(args[0], args[1], args[2]),
        ),
    );

    registerCodeActionsProviders(context);
}

export function deactivate() {
    disposeCodeActionsProviders();
    logger.dispose();
}
