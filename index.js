import util  from 'util';
import binaryen  from 'binaryen';

class Parser {
    input = ''
    index = 0;

    eof() {
        return this.index >= this.input.length;
    }

    char() {
        return this.input[this.index]
    }

    skipWhitespace() {
        while (!this.eof()) {
            const char = this.input[this.index]
            if(!char.match(/\s/)) {
                break;
            }
            this.index++;
        }
    }

    isIdentifierStart(char) {
        return char.match(/[a-zA-Z_]/);
    }

    isIdentifierPart(char) {
        return char.match(/[a-zA-Z_0-9]/);
    }

    readIdentifer() {
        const start = this.index;
        while (!this.eof()) {
            if(!this.isIdentifierPart(this.char())) {
                break;
            }
            this.index++;
        }

        const value = this.input.slice(start, this.index)
        return {
            kind: 'IDENTIFIER',
            value
        }
    }

    readNumber() {
        const start = this.index;
        while (!this.eof()) {
            if(!this.char().match(/[0-9]/)) {
                break;
            }
            this.index++;
        }

        const raw = this.input.slice(start, this.index)
        return {
            kind: 'NUMBER',
            raw,
            value: Number(raw)
        }
    }

    readWithoutWhiteSpace() {
        if(this.eof()) {
            return { kind: 'EOF'};
        }
        const char = this.char();

        if (this.isIdentifierStart(char)) {
            const token = this.readIdentifer();
            switch(token.value) {
                case "function":
                case "return":
                    return { kind: token.value }
                default:
                    return token;
            }
        }

        switch(char) {
            case '(':
            case ')':
            case '{':
            case '}':
            case ';':
                this.index++;
                return { kind: char }
        }

        if (char.match(/[0-9]/)) {
            return this.readNumber();
        }

        throw new Error(`Unexpected character ${JSON.stringify(char)}`);
    }

    read() {
        if(this.lookhead) {
            const token = this.lookhead;
            this.lookhead = null;
            return token;
        }
        this.skipWhitespace();
        const token = this.readWithoutWhiteSpace();
        this.skipWhitespace();
        return token;
    }

    lookhead = null

    peek() {
        if(!this.lookhead) {
            const token = this.read();
        this.lookhead = token;
        return this.lookhead;
        }
        return this.lookhead;
    }

    match(kind) {
        const token = this.read();
        if(token.kind !== kind) {
            throw new Error(`Expected ${JSON.stringify(kind)} but found ${JSON.stringify(token.kind)}`)
        }
        return token;
    }

    parseNumber() {
        const token = this.match('NUMBER');
        return {
            kind: 'NumberLiteral',
            text: token.raw,
            type: 'i32',
            value: token.value
        }
    }

    parseExpression() {
        const token = this.peek();
        switch(token.kind) {
            case 'NUMBER':
                return this.parseNumber();
            default:
                throw new Error(`Expected expression but found ${JSON.stringify(token.kind)}`)
        }
    }

    parseReturnStatement() {
        this.match('return');
        const argument = this.parseExpression();
        return {
            kind: 'ReturnStatement',
            argument
        }
    }

    parseStatementWithoutSemicolon() {
        const token = this.peek();
        switch(token.kind) {
            case 'return':
                return this.parseReturnStatement();
            default:
                throw new Error(`Expected statement but found ${JSON.stringify(token.kind)}`)
        }
    }

    parseStatement() {
        const node = this.parseStatementWithoutSemicolon();
        if(this.peek().kind === ';') {
            this.match(';')
        }
        return node
    }

    parseBlock() {
        this.match('{')
        const body = [];

        while(!this.eof()) {
            if(this.peek().kind === "}") {
                break;
            }

            const child = this.parseStatement();
            body.push(child);
        }

        this.match('}')

        return {
            kind: 'Block',
            body
        }
    }

    parseFunctionDeclaration() {
        this.match('function');
        const name = this.match('IDENTIFIER');
        this.match('(');
        this.match(')');
        const body = this.parseBlock();

        return {
            kind: 'FunctionDeclaration',
            name,
            body
        }
    }

    parseaTopLevelStatement() {
        const token = this.peek()

        switch(token.kind) {
            case 'function': 
            return this.parseFunctionDeclaration();
            default:
                throw new Error(`Expected top level statement but found ${JSON.stringify(token.kind)}`)
        }
    }

    parse(input) {
        this.input = input;
        this.index = this.index;
        const body = []
        while(!this.eof()) {
            const node = this.parseaTopLevelStatement();
            body.push(node)
        }
        return {
            kind: 'Script',
            body
        };
    }
}

class CodegenVisitor {
    module = new binaryen.Module();

    visitNumberLiteral(node) {
        return this.module.i32.const(node.value)
    }

    visitReturnStatement(node) {
        const argument = this.visit(node.argument);
        return this.module.return(argument);
    }

    visitBlock(node) {
        const body = [];
        for (const child of node.body) {
            const node = this.visit(child);
            body.push(node);
        }
        return this.module.block('', body);
    }
    visitFunctionDeclaration(node) {
        console.log(node)
        const name = node.name.value
        const returnType = binaryen.i32;
        const body = this.visit(node.body);

        this.module.addFunction(name, binaryen.createType([]), returnType, [], body)
        this.module.addFunctionExport(name, name);
    }
    visitScript(node) {
        console.log(node)
        for (const child of node.body) {
            this.visit(child)
        }

        this.module.validate();

        return this.module
    }
    visit(node) {
        const methodName = `visit${node.kind}`
        if(typeof this[methodName] == 'function') {
            return this[methodName](node)
        }

        throw new Error(`Unexpected node kind ${node.kind}`)
    }
}

async function main() {
    const parser = new Parser();
    const ast = parser.parse(` 
        function main() {
            return 249;
        }

        function second() {
            return 111;
        }
    `);

    const codegen = new CodegenVisitor();
    const module = codegen.visit(ast);
    console.log(module.emitText())
    const binary = module.emitBinary();
    const { instance } = await WebAssembly.instantiate(binary)
    console.log(instance.exports.main())
    console.log(instance.exports.second())

    console.log(
        util.inspect(ast, {
            showHidden: false,
            depth: null,
            colors: true
        })
    );
}

main();