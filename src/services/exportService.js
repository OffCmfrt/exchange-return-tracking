const ExcelJS = require('exceljs');
const { streamRequestsForExport } = require('../../config/db-helpers');

const BATCH_SIZE = 1000;
const MAX_EXPORT_ROWS = 200000;

const HEADERS = [
    'Request ID', 'Type', 'Status', 'Order Number', 'Customer Name',
    'Customer Email', 'Customer Phone', 'Carrier', 'AWB Number',
    'Shipment ID', 'Pickup Date', 'Reason', 'Comments',
    'Items', 'Shipping Address', 'Shipping City', 'Shipping State',
    'Shipping Pincode', 'Payment ID', 'Payment Amount', 'COD Charges',
    'Admin Notes', 'Agent Notes', 'Created At', 'Updated At'
];

const COLUMN_WIDTHS = {
    'Request ID': 16, 'Type': 10, 'Status': 16, 'Order Number': 14,
    'Customer Name': 20, 'Customer Email': 26, 'Customer Phone': 15,
    'Carrier': 12, 'AWB Number': 16, 'Shipment ID': 16,
    'Pickup Date': 14, 'Reason': 16, 'Comments': 30,
    'Items': 40, 'Shipping Address': 30, 'Shipping City': 16,
    'Shipping State': 14, 'Shipping Pincode': 12, 'Payment ID': 18,
    'Payment Amount': 14, 'COD Charges': 12, 'Admin Notes': 30,
    'Agent Notes': 30, 'Created At': 20, 'Updated At': 20
};

const STATUS_COLORS = {
    pending: 'FFFFF7ED',
    approved: 'FFECFDF5',
    rejected: 'FFFEF2F2',
    pickup_pending: 'FFFFFBEB',
    scheduled: 'FFEFF6FF',
    picked_up: 'FFECFDF5',
    in_transit: 'FFEFF6FF',
    delivered: 'FFECFDF5',
    cancelled: 'FFFEF2F2',
    failed: 'FFFEF2F2',
    waiting_payment: 'FFFEF9C3',
    payment_received: 'FFECFDF5'
};

function getDateSuffix(dateFrom, dateTo) {
    if (dateFrom && dateTo) return `${dateFrom}_to_${dateTo}`;
    if (dateFrom) return `from_${dateFrom}`;
    if (dateTo) return `until_${dateTo}`;

    return new Date().toISOString().slice(0, 10);
}

function mapRequestToRow(req) {
    return [
        req.requestId || '',
        req.type || '',
        req.status || '',
        req.orderNumber || '',
        req.customerName || '',
        req.customerEmail || '',
        req.customerPhone || '',
        req.carrier || '',
        req.awbNumber || '',
        req.shipmentId || '',
        req.pickupDate || '',
        req.reason || '',
        (req.comments || '').replace(/[\n\r]+/g, ' '),
        Array.isArray(req.items)
            ? req.items.map(i => i.name || i.title || JSON.stringify(i)).join('; ')
            : '',
        req.shippingAddress || '',
        req.shippingCity || '',
        req.shippingState || '',
        req.shippingPincode || '',
        req.paymentId || '',
        req.paymentAmount || 0,
        req.codCharges || 0,
        (req.adminNotes || '').replace(/[\n\r]+/g, ' '),
        (req.agentNotes || '').replace(/[\n\r]+/g, ' '),
        req.createdAt
            ? new Date(req.createdAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata'
            })
            : '',
        req.updatedAt
            ? new Date(req.updatedAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata'
            })
            : ''
    ];
}

function writeWithBackpressure(res, chunk) {
    if (res.destroyed || res.writableEnded) {
        return Promise.reject(new Error('Export response was closed'));
    }

    if (res.write(chunk)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            res.removeListener('drain', onDrain);
            res.removeListener('close', onClose);
            res.removeListener('error', onError);
        };

        const onDrain = () => {
            cleanup();
            resolve();
        };

        const onClose = () => {
            cleanup();
            reject(new Error('Export response was closed'));
        };

        const onError = error => {
            cleanup();
            reject(error);
        };

        res.once('drain', onDrain);
        res.once('close', onClose);
        res.once('error', onError);
    });
}

function updateSummary(request, summary) {
    if (request.type === 'return') summary.totalReturns++;
    if (request.type === 'exchange') summary.totalExchanges++;

    const status = request.status || 'Unknown';
    summary.statusCounts[status] =
        (summary.statusCounts[status] || 0) + 1;
}

function createSummary() {
    return {
        totalRecords: 0,
        totalReturns: 0,
        totalExchanges: 0,
        statusCounts: {}
    };
}

function createCsvLine(row) {
    return row
        .map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(',') + '\n';
}

async function exportCsv(res, firstPage, iterator, signal, summary) {
    await writeWithBackpressure(res, '\uFEFF');
    await writeWithBackpressure(res, HEADERS.join(',') + '\n');

    async function writePage(page) {
        for (const request of page) {
            if (signal.aborted) {
                throw new Error('Export aborted');
            }

            if (summary.totalRecords >= MAX_EXPORT_ROWS) {
                throw new Error(`Export exceeds the ${MAX_EXPORT_ROWS} row limit`);
            }

            const row = mapRequestToRow(request);

            await writeWithBackpressure(res, createCsvLine(row));

            summary.totalRecords++;
            updateSummary(request, summary);
        }
    }

    await writePage(firstPage);

    for await (const page of iterator) {
        if (signal.aborted) throw new Error('Export aborted');
        await writePage(page);
    }

    res.end();
}

async function exportXlsx(res, firstPage, iterator, signal, summary, dateFrom, dateTo) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useSharedStrings: false,
        useStyles: true
    });

    workbook.creator = 'OFFCOMFRT Admin';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Returns & Exchanges', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet.columns = HEADERS.map((header, index) => ({
        header,
        key: `col_${index}`,
        width: Math.max(header.length + 2, 14)
    }));

    sheet.columns.forEach(column => {
        column.width = COLUMN_WIDTHS[column.header] || 14;
    });

    const headerRow = sheet.getRow(1);
    headerRow.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 11
    };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF111827' }
    };
    headerRow.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true
    };
    headerRow.border = {
        bottom: {
            style: 'thin',
            color: { argb: 'FF374151' }
        }
    };
    headerRow.height = 22;
    headerRow.commit();

    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: HEADERS.length }
    };

    const statusColIdx = HEADERS.indexOf('Status') + 1;
    const createdAtColIdx = HEADERS.indexOf('Created At') + 1;

    async function writePage(page) {
        for (const request of page) {
            if (signal.aborted) {
                throw new Error('Export aborted');
            }

            if (summary.totalRecords >= MAX_EXPORT_ROWS) {
                throw new Error(`Export exceeds the ${MAX_EXPORT_ROWS} row limit`);
            }

            const row = sheet.addRow(mapRequestToRow(request));

            row.alignment = {
                vertical: 'middle',
                wrapText: true
            };

            if (row.number % 2 === 0) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF9FAFB' }
                };
            }

            const statusCell = row.getCell(statusColIdx);
            statusCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                    argb: STATUS_COLORS[request.status] || 'FFFFFFFF'
                }
            };

            row.getCell(createdAtColIdx).numFmt = 'dd/mm/yyyy hh:mm AM/PM';

            row.commit();

            summary.totalRecords++;
            updateSummary(request, summary);
        }
    }

    await writePage(firstPage);

    for await (const page of iterator) {
        if (signal.aborted) throw new Error('Export aborted');
        await writePage(page);
    }

    sheet.commit();

    const summarySheet = workbook.addWorksheet('Summary');

    summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 24 },
        { header: 'Value', key: 'value', width: 16 }
    ];

    const summaryHeader = summarySheet.getRow(1);
    summaryHeader.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' }
    };
    summaryHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF111827' }
    };
    summaryHeader.alignment = {
        vertical: 'middle',
        horizontal: 'center'
    };
    summaryHeader.commit();

    const summaryData = [
        ['Total Records', summary.totalRecords],
        ['Total Returns', summary.totalReturns],
        ['Total Exchanges', summary.totalExchanges],
        ['Date From', dateFrom || 'All time'],
        ['Date To', dateTo || 'Present'],
        ...Object.entries(summary.statusCounts).map(
            ([status, count]) => [`Status: ${status}`, count]
        )
    ];

    for (const [metric, value] of summaryData) {
        summarySheet.addRow({ metric, value }).commit();
    }

    summarySheet.commit();

    await workbook.commit();
}

/**
 * Generate a streaming XLSX or CSV export of return/exchange requests.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 */
async function exportRequests(req, res) {
    const {
        status,
        type,
        carrier,
        dateFrom,
        dateTo,
        date,
        search,
        format
    } = req.query;

    const exportFormat = format === 'csv' ? 'csv' : 'xlsx';
    const dateSuffix = getDateSuffix(dateFrom, dateTo);

    const filters = {
        status,
        type,
        carrier,
        dateFrom,
        dateTo,
        date,
        search
    };

    const controller = new AbortController();
    const startedAt = Date.now();
    let peakHeapUsed = process.memoryUsage().heapUsed;

    const onClose = () => {
        if (!res.writableEnded) {
            controller.abort();
        }
    };

    res.on('close', onClose);

    try {
        const iterator = streamRequestsForExport(filters, {
            batchSize: BATCH_SIZE,
            signal: controller.signal
        })[Symbol.asyncIterator]();

        // Fetch the first page before sending headers.
        // This preserves the existing 404 response for empty exports.
        const firstResult = await iterator.next();
        const firstPage = firstResult.done ? [] : firstResult.value;

        if (!firstPage || firstPage.length === 0) {
            return res.status(404).json({
                error: 'No data found for the selected filters'
            });
        }

        if (controller.signal.aborted) return;

        res.setHeader(
            'Content-Type',
            exportFormat === 'csv'
                ? 'text/csv;charset=utf-8;'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="return_exchange_${dateSuffix}.${exportFormat}"`
        );

        const summary = createSummary();

        if (exportFormat === 'csv') {
            await exportCsv(
                res,
                firstPage,
                iterator,
                controller.signal,
                summary
            );
        } else {
            await exportXlsx(
                res,
                firstPage,
                iterator,
                controller.signal,
                summary,
                dateFrom,
                dateTo
            );
        }

        peakHeapUsed = Math.max(
            peakHeapUsed,
            process.memoryUsage().heapUsed
        );

        console.log('[Export] Completed', {
            format: exportFormat,
            rows: summary.totalRecords,
            durationMs: Date.now() - startedAt,
            peakHeapMB: (peakHeapUsed / 1024 / 1024).toFixed(2)
        });

        return summary;
    } finally {
        res.removeListener('close', onClose);
    }
}

module.exports = {
    exportRequests
};