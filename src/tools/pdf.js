/**
 * Exportar página como PDF via CDP Page.printToPDF.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function createPdfTools({ caller }) {
  const printToPdf = {
    name: 'print_to_pdf',
    description: 'Exports the current page as a PDF file and saves it to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to save the PDF. Default: ~/Downloads/page.pdf',
        },
        landscape:        { type: 'boolean', description: 'Default false' },
        printBackground:  { type: 'boolean', description: 'Include backgrounds. Default true' },
        scale:            { type: 'number',  description: 'Page scale 0.1–2. Default 1' },
        paperWidth:       { type: 'number',  description: 'Paper width in inches. Default 8.5' },
        paperHeight:      { type: 'number',  description: 'Paper height in inches. Default 11' },
        marginTop:        { type: 'number',  description: 'Top margin in inches. Default 0.4' },
        marginBottom:     { type: 'number',  description: 'Bottom margin in inches. Default 0.4' },
        marginLeft:       { type: 'number',  description: 'Left margin in inches. Default 0.4' },
        marginRight:      { type: 'number',  description: 'Right margin in inches. Default 0.4' },
      },
    },
    async handler(args) {
      const result = await caller.call('Page.printToPDF', {
        landscape:       args.landscape       ?? false,
        printBackground: args.printBackground ?? true,
        scale:           args.scale           ?? 1,
        paperWidth:      args.paperWidth,
        paperHeight:     args.paperHeight,
        marginTop:       args.marginTop,
        marginBottom:    args.marginBottom,
        marginLeft:      args.marginLeft,
        marginRight:     args.marginRight,
        transferMode:    'ReturnAsBase64',
      });

      const outPath = args.filePath
        ?? path.join(os.homedir(), 'Downloads', 'page.pdf');

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(result.data, 'base64'));

      return [{ type: 'text', text: `PDF guardado en: ${outPath}` }];
    },
  };

  return [printToPdf];
}

module.exports = { createPdfTools };
