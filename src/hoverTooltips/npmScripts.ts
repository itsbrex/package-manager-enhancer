import { dirname } from 'node:path';

import type { CancellationToken, HoverProvider, Position, TextDocument } from 'vscode';
import { Hover, MarkdownString, Range } from 'vscode';

import { commands } from '../utils/constants';
import { parseJsonc } from '../utils/jsonc';

export class NpmScriptsHoverProvider implements HoverProvider {
    async provideHover(
        document: TextDocument,
        position: Position,
        _token: CancellationToken,
    ): Promise<Hover | undefined> {
        const filePath = document.uri.fsPath;
        const packageJson = document.getText();

        const { findNodeAtOffset, findNodeAtLocation } = await import('jsonc-parser');
        const root = await parseJsonc(packageJson);
        if (!root) return;

        const scriptNameNode = findNodeAtOffset(root, document.offsetAt(position));
        const scriptsNode = findNodeAtLocation(root, ['scripts']);
        const hoverOverScriptName =
            scriptNameNode?.type === 'string' &&
            scriptNameNode.parent?.type === 'property' &&
            scriptNameNode === scriptNameNode.parent.children?.[0] &&
            scriptNameNode.parent.parent === scriptsNode;
        if (!hoverOverScriptName) return;

        const scriptName = scriptNameNode.value;
        const script = `npm run ${scriptName}`;
        const args = encodeURI(
            JSON.stringify({
                scriptName,
                script,
                cwd: dirname(filePath),
            }),
        );
        const runBackgroundUrl = `command:${commands.runNpmScriptBackground}?${args} "Run the script as a background task"`;
        const link = `[Run Background](${runBackgroundUrl})`;
        const markdownStr = new MarkdownString(link);
        markdownStr.isTrusted = true;
        const range = new Range(
            document.positionAt(scriptNameNode.offset),
            document.positionAt(scriptNameNode.offset + scriptName.length),
        );

        markdownStr.appendText(' | ');
        const runInTerminalUrl = `command:${commands.runNpmScriptInTerminal}?${args} "Run the script in terminal"`;
        markdownStr.appendMarkdown(`[Run in Terminal](${runInTerminalUrl})`);
        return new Hover(markdownStr, range);
    }
}
