import { existsSync, readFileSync } from 'node:fs';

const defaults = {
	maxFileLines: 220,
	maxFunctionLines: 55,
	maxClassLines: 120,
	maxMethodLines: 35,
	maxNestingDepth: 4,
	maxParameters: 4,
	maxComplexity: 10,
	maxClassesPerFile: 1
};

export const harnessRuleLimits = readHarnessLimits();

export default {
	rules: {
		'max-class-lines': sizeRule('Class', harnessRuleLimits.maxClassLines, 'ClassDeclaration'),
		'max-method-lines': sizeRule('Method', harnessRuleLimits.maxMethodLines, 'MethodDefinition'),
		'no-manager-name': {
			meta: {
				type: 'suggestion',
				messages: { manager: 'Avoid catch-all Manager class names.' }
			},
			create(context) {
				return {
					ClassDeclaration(node) {
						if (node.id?.name?.endsWith('Manager')) {
							context.report({ node: node.id, messageId: 'manager' });
						}
					}
				};
			}
		}
	}
};

function readHarnessLimits() {
	const path = new URL('./harness.audit.json', import.meta.url);
	if (!existsSync(path)) return defaults;
	const config = JSON.parse(readFileSync(path, 'utf8'));
	return { ...defaults, ...positiveLimits(config.limits ?? {}) };
}

function positiveLimits(config) {
	return Object.fromEntries(
		Object.entries(config).filter(([, value]) => Number.isInteger(value) && value > 0)
	);
}

function sizeRule(label, max, selector) {
	return {
		meta: {
			type: 'suggestion',
			messages: { tooLarge: label + ' has {{lines}} lines. Limit is {{max}}.' }
		},
		create(context) {
			return {
				[selector](node) {
					const lines = node.loc.end.line - node.loc.start.line + 1;
					if (lines > max) {
						context.report({ node, messageId: 'tooLarge', data: { lines, max } });
					}
				}
			};
		}
	};
}
