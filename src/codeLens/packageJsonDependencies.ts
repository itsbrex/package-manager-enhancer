import { dirname } from 'node:path';

import type { Node } from 'jsonc-parser';
import type { CancellationToken, ExtensionContext, Position, Range, TextDocument } from 'vscode';
import { CodeLens, workspace } from 'vscode';

import { configuration, configurationKeys } from '../configuration';
import { commands } from '../utils/constants';
import { jsoncStringNodeToRange, parseJsonc } from '../utils/jsonc';
import type { SearchImportsMatch } from '../utils/searchImports';
import { BaseCodeLensProvider } from './BaseCodeLensProvider';

interface Dependency {
    name: string;
    range: Range;
}

interface CodeLensData {
    type: 'imports' | 'type imports';
    depName: string;
    position: Position;
    searchImportsPromise: Promise<SearchImportsMatch[]>;
}

interface SearchCacheData {
    status: 'searching' | 'done';
    searchImportsPromise: Promise<SearchImportsMatch[]>;
}

export class PackageJsonDependenciesCodeLensProvider extends BaseCodeLensProvider {
    private _codeLensDataMap: Map<CodeLens, CodeLensData> = new Map();
    private _searchCache: Map<string, SearchCacheData> = new Map();

    constructor(context: ExtensionContext) {
        super(
            context,
            async (document: TextDocument) => {
                const isIgnored = async () => {
                    if (configuration.packageJsonDependenciesCodeLens.ignorePatterns.length === 0)
                        return false;

                    const { default: micromatch } = await import('micromatch');
                    return (
                        micromatch(
                            [document.uri.fsPath],
                            configuration.packageJsonDependenciesCodeLens.ignorePatterns,
                            {
                                cwd: workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
                            },
                        ).length === 0
                    );
                };

                return configuration.enablePackageJsonDependenciesCodeLens && !(await isIgnored());
            },
            (e) =>
                e.affectsConfiguration(configurationKeys.enablePackageJsonDependenciesCodeLens) ||
                e.affectsConfiguration(configurationKeys.packageJsonDependenciesCodeLens._key),
        );
    }

    protected _reset() {
        this._codeLensDataMap.clear();
        this._searchCache.clear();
    }

    async getDependencies(root: Node, path: string[]) {
        const { findNodeAtLocation } = await import('jsonc-parser');
        const dependencies: Dependency[] = [];
        const dependenciesNode = findNodeAtLocation(root, path);
        if (
            !dependenciesNode ||
            dependenciesNode.type !== 'object' ||
            !dependenciesNode.children ||
            dependenciesNode.children.length === 0
        )
            return dependencies;

        for (const depEntryNode of dependenciesNode.children) {
            if (depEntryNode.children?.length !== 2) continue;
            const [depNameNode, depVersionNode] = depEntryNode.children;
            if (depNameNode.type !== 'string' || depVersionNode.type !== 'string') continue;

            dependencies.push({
                name: depNameNode.value,
                range: jsoncStringNodeToRange(this._document!, depEntryNode),
            });
        }

        return dependencies;
    }

    async getCodeLenses(
        document: TextDocument,
        _token: CancellationToken,
    ): Promise<CodeLens[] | undefined> {
        const packageJson = document.getText();
        const root = await parseJsonc(packageJson);
        if (!root) return;

        const dependencies: Dependency[] = (
            await Promise.all(
                configuration.packageJsonDependenciesCodeLens.dependenciesNodePaths.map(
                    (nodePath) => this.getDependencies(root!, nodePath.split('.')),
                ),
            )
        ).flat();

        const { searchImports } = await import('../utils/searchImports');
        return dependencies.map((dep) => {
            const importsCodeLens = new CodeLens(dep.range);
            let searchImportsPromise: Promise<SearchImportsMatch[]>;
            if (this._searchCache.has(dep.name)) {
                searchImportsPromise = this._searchCache.get(dep.name)!.searchImportsPromise;
            } else {
                const cacheData: SearchCacheData = {
                    status: 'searching',
                    searchImportsPromise: undefined as unknown as Promise<SearchImportsMatch[]>,
                };
                searchImportsPromise = searchImports(dep.name, dirname(this._document!.uri.fsPath))
                    .then((matches) => {
                        cacheData.status = 'done';
                        this._onDidChangeCodeLenses.fire();
                        return matches;
                    })
                    .catch((error) => {
                        this._searchCache.delete(dep.name);
                        throw error;
                    });
                cacheData.searchImportsPromise = searchImportsPromise;
                this._searchCache.set(dep.name, cacheData);
            }
            this._codeLensDataMap.set(importsCodeLens, {
                type: 'imports',
                depName: dep.name,
                position: dep.range.start,
                searchImportsPromise,
            });

            return importsCodeLens;
        });
    }

    async resolveCodeLens(
        codeLens: CodeLens,
        _token: CancellationToken,
    ): Promise<CodeLens | undefined> {
        const data = this._codeLensDataMap.get(codeLens);
        if (!data) return codeLens;

        if (this._searchCache.get(data.depName)!.status === 'searching') {
            codeLens.command = {
                title: 'searching imports...',
                command: '',
                tooltip: 'When you see this, means search imports costs long time',
            };
            return codeLens;
        }

        const matches = await data.searchImportsPromise;
        const typeImportsCount = matches.filter((match) => match.isTypeImport).length;
        const count = matches.length;
        let title: string;
        let command: string;
        let tooltip: string;
        let args: any[];
        if (count === 0) {
            title = 'unused';
            tooltip = 'click to remove this dependency';
            command = commands.removeUnusedDependency;
            args = [data.position.line];
        } else {
            const isOnlyTypeImports = count === typeImportsCount;
            title = `${count} ${isOnlyTypeImports ? 'type imports' : 'imports'}`;
            tooltip = `click to open the ${data.type} in references panel`;
            command = commands.showReferencesInPanel;
            args = [this._document!.uri, data.position, matches];
        }

        codeLens.command = {
            title,
            command,
            arguments: args,
            tooltip,
        };
        return codeLens;
    }
}
