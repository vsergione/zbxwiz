
/**
 * @param string title - modal title
 * @param string body - modal content
 * @param string footer - modal footer
 */
function show_modal(opts={}) {
    let title = opts.title ? opts.title : null;
    let body = opts.body ? opts.body : null;
    let footer = opts.footer ? opts.footer : null;
    let $modal = $("#generic_modal").clone().appendTo("body").removeAttr("id")   // clone modal template
        .on("hidden.bs.modal",()=>$modal.remove())  // setup cleanup after modal is closed
        .modal();   // open modal

    // set modal title if present
    if(!opts.title) {
        $modal.find(".modal-header").remove()
    }
    else {
        $modal.find(".modal-header").html(opts.title);
    }
    // set footer if present
    if(opts.footer) {
        $modal.find(".modal-header").html(opts.footer)
    }
    // set modal content
    $modal.find(".modal-body").html(opts.body ? opts.body : "No content");
    if(opts.size) {
        $modal.find(".modal-dialog").addClass("modal-"+opts.size);
    }
}

let zbx,apiUrl,apiKey;
let specs = {};

function load_req_tpl(editor,key) {
    if(key.length) 
        editor.setText(localStorage.getItem(key));
}


function import_zbx(reqTpl,form) {
    let method = form.resource.value+".get";
    let params = JSON.parse(reqTpl);
    overlay.show();
    zbx.get(form.resource.value,params).then((data)=>{
        if(!data.result)
            return alert("Could not fetch data");
        if(!data.result.length===0)
            return alert("No records found");
        data = {
            fields:Object.keys(data.result[0]),
            records: data.result
        };
        /**
         *
         * @type {DataTable}
         */
        let dt = get_active_sheet();
        dt.load_data(data.fields,data.records);
        localStorage.setItem(dt.container_id+"-data",JSON.stringify(data));
    }).finally(()=>overlay.hide());
}

function remove_template(btn) {
    $(btn.form.templates).children().toArray()
        .forEach(opt=>{
            if(opt.selected) {
                localStorage.removeItem(opt.value);
                $(opt).remove();
            }
        });
}

/**
 * push data to zabbix
 */
function push(template,form) {
    let method = form.resource.value+"."+form.operation.value;
    if(form.operation.value==="update") {
        dt.rows.filter(row=>row.selected).forEach((row)=>{
            row.el
                .removeClass("loading")
                .removeClass("synced")
            with(row.data) {
                let req = eval("`"+template+"`");
                try{
                    let params = JSON.parse(req);
                    // console.log(row.data,params);
                    // return;
                    overlay.show();
                    zbx.req(method,params).then((resp)=>{
                        console.log(resp)
                        if(resp.result) {
                            //row.el.data("zbxData",zbxData)
                            row.el.addClass("synced")
                        }
                    })
                        .catch(()=>row.el.addClass("syncfailed"))
                        .finally(()=>{
                        row.el.removeClass("loading");
                        overlay.hide()
                    });
                    row.el.addClass("loading");
                }
                catch(e) {
                    console.log(e);
                }
                
            }
        });
    }
}

/**
 * pull data from zabbix
 */
function pull(template,form) {
    if(form.postprocess.value==="update") {
        //console.log(dt.rows);

        // if(row) {
        //     let data = {
        //         data: row.data,
        //         cols: row.vals,
        //         flds: row.fld_vals
        //     };
        //     console.log(data);
        //     with(data) {
        //         try {
        //             previewEl.text(eval("`"+editor.getText()+"`"));
        //         }
        //         catch(e) {
        //             previewEl.text("Invalid template. Fix it!")
        //         }
        //     }
        // }
        // else {
        //     previewEl.text("No rows selected")
        // }
        overlay.show();
        let ps = [];
        get_active_sheet().rows.filter(row=>row.isSelected).forEach((row)=>{
            console.log(row);
            let data = {
                data: row.data,
                cols: row.vals,
                flds: row.fld_vals
            };

            with(data) {
                let req = eval("`"+template+"`");
                try{

                    ps.push(zbx.get(form.resource.value,JSON.parse(req))
                        .then((resp)=>{
                            if(resp.result && resp.result.length) {
                                row.data[form.label.value] = resp.result;
                                row.unset_loading();
                            }
                        }).finally(()=>{
                            overlay.hide();
                            row.unset_loading();
                        }));
                }
                catch(e) {
                    console.log(e);
                }
            }

        });
        Promise.all(ps).catch((e)=>alert("Some error happend")).finally(()=>overlay.hide());
    }
}



function auto_save() {
    let rows = dt.rows;
    let data = {fields:[],records:[]}
    let fields;
    if(rows.length) {
        data.fields = Object.keys(rows[0].data).filter(fld=>fld!=="rowRef");
    }
    
    rows.forEach((row)=>{
        let tmp = Object.assign({},row.data);
        delete tmp.rowRef;
        data.records.push(tmp);
    });
    console.log(data);
}


function downloadBlob(content, filename, contentType) {
    // Create a blob
    var blob = new Blob([content], { type: contentType });
    var url = URL.createObjectURL(blob);

    // Create a link to download it
    var pom = document.createElement('a');
    pom.href = url;
    pom.setAttribute('download', filename);
    pom.click();
}

function save_data() {
    let dt = get_active_sheet();
    let data = dt.export();
    console.log(data);
    csv = Papa.unparse(data,{
        quotes: true, //or array of booleans
        quoteChar: '"',
        escapeChar: '"',
        delimiter: ",",
        header: true,
        newline: "\n",
        skipEmptyLines: false, //other option is 'greedy', meaning skip delimiters, quotes, and whitespace.
        columns: null //or array of strings
    });
    console.log(csv);
    downloadBlob(csv,"backup.csv","text/csv;charset=utf-8;");
}


/**
 *
 * @param event
 * @param apply
 */
function transform_data(event,apply=false){
    let src = event.target;
    let el = src.form.xpression;
    let col = $(el).parents("th").data("col");
    let expr = el.value;

    /**
     *
     * @param {Cell} cell
     * @returns {any}
     */
    function transform(cell) {
        console.log(cell);
        let data = {
            data: cell.row.data,
            cols: cell.row.vals,
            flds: cell.row.fld_vals,
            self: cell.val,
            ws: workSheets
       };

        if(expr!=="")
            with(data){
                let newVal = eval(expr);
                if(newVal.constructor===Object || newVal.constructor===Array) {
                    let tmp = JSON.stringify(newVal)
                    if(tmp.length<200){
                        newVal = tmp;
                    }
                }
                return newVal;
            }
    }

    /**
     * @type {DataTable}
     */
    let dt = get_active_sheet();
    let colCells = dt.get_col_by_num(col);

    if(!apply)  {
        try {
            let newVal = transform(colCells[0]);

            el.form.preview.value = (typeof newVal!=="undefined")? newVal : $(colCells[0]).text()
        }
        catch(e) {
            console.log(e);
            el.form.preview.value = "Error: "+e.message
        }
        return;
    }
    

    colCells.forEach((cell)=>{
        cell.val = transform(cell);
    });
    src.form.reset();
    minimize_transform(event,true);
}

/**
 *
 * @param form
 */
function filter_rows(form){
    let rgx = form.filter.value.replaceAll("{value}",form.term.value);
    rgx = rgx ? rgx : ".*";
    let th = $(form).parents("th");
    let col = th.data("col");
    console.log("remove filter",th.removeClass("filterActive"));


    rgx = new RegExp(rgx,"i");

    console.log("add filter",rgx,th.addClass("filterActive"));
    /**
     *
     * @type {DataTable}
     */
    let dt = get_active_sheet();
    dt.get_col_by_num(col).forEach(col=> {
        if(!rgx.test(col.val)) {
            console.log("filterOut",col);
            col.row.filter_out(col);
        }
        else {
            console.log("filterIn",col);
            col.row.filter_in(col);
        }
    });

}




function toggle_all_visible(src){
    let inps = $("#preview>tbody>tr:not(.d-none) input[type=checkbox]");
    
    let checked = src.checked;
    inps.each((idx,inp)=>{
        inp.checked=checked
        $(inp).trigger("change");
    })
}

function toggleSmall(event) {
    console.log(event);
    if(event.target.tagName!=="TH") return;
    let el = $(event.target);
    let col = el.data("col")+1;
    if(el.hasClass("small")) {
        $("#preview>thead>tr:first-child>th:nth-child("+col+")").removeClass("small");
        $("#preview>thead>tr:not(:first-child)>th:nth-child("+(col-1)+")").removeClass("small");
        $("#preview td:nth-child("+col+")").removeClass("small");
    }
    else {
        $("#preview>thead>tr:first-child>th:nth-child("+col+")").addClass("small");
        $("#preview>thead>tr:not(:first-child)>th:nth-child("+(col-1)+")").addClass("small");
        $("#preview td:nth-child("+col+")").addClass("small");
    }
}


function info(src) {
    let data = Object.assign({},$(src).parents('tr').data());
    delete data.rowRef;
    console.log(data);
    show_modal({
        body:"<div class='bg-light'><pre >"+JSON.stringify(data,null,4)+"</pre></div>",
        title: "Record "+data.rowIdx,
        size: "lg"
    })
}


// Array.prototype.unique = function(){
//     function distinct(value, index, array) {
//         return array.indexOf(value) === index;
//     }
//     return this.filter(distinct);
// };

function load_csv(input) {
    /**
     *
     * @type {DataTable}
     */
    let dt = get_active_sheet();
    let a = $(input).parse({
        config: {
            header: true,
            complete: (data)=>{
                console.log(data);
                data = {
                    records: data.data,
                    fields: data.meta.fields
                };
                localStorage.setItem(dt.container_id+"-data",JSON.stringify(data));
                console.log(data);
                dt.load_data(data.fields,data.records)
            }
        }
    });
    console.log(a);
}

/**
 *
 * @returns {DataTable}
 */
function get_active_sheet() {
    let container = $($("#sheetSelector").find("button.active").attr("data-target"));
    if(container)
        return container.data("dt");
    return;
}
function load_api_key(src) {
    $.get("./zbx_api_key.txt").then(data=>{
        src.form.token.value = data;
    });
}
function load_api_url(src) {
    $.get("./zbx_url.txt").then(data=>{
        src.form.url.value = data;
    });
}

function save_zbx_config(form) {
    $("#zbxLogo").addClass("notConnected");
    localStorage.setItem("zbxUrl",form.url.value);
    localStorage.setItem("zbxToken",form.token.value);
    zbx_connect();
}

function zbx_connect() {
    let url = localStorage.getItem("zbxUrl");
    let token = localStorage.getItem("zbxToken");
    $("#zbxConfigForm")[0].url.value = url;
    $("#zbxConfigForm")[0].token.value = token;
    zbx = new ZBXApi(url,token);
    overlay.show();
    zbx.get("host",{limit:1}).then(data=>{
        if(typeof data.result!==undefined) {
            $("#zbxLogo").removeClass("notConnected");
        }
    }).finally(()=>overlay.hide());
}


function save_req_tpl(prefix,selectId,editor) {
    let name = prompt("Template name");
    localStorage.setItem(prefix+name,editor.getText());
    setup_req_tpl_select(selectId,prefix);
}

function setup_req_tpl_select(id,prefix) {
    let sel = $(id).empty().append("<option value=''>Select template</option>");
    let prefixLen = prefix.length;
    Object.keys(localStorage)
        .filter(key=>key.indexOf(prefix)!==-1)
        .forEach(key=>$("<option>").text(key.substr(prefixLen)).attr("value",key).appendTo(sel));
}

function preview_request(editor) {
    try {
        let previewEl = $(editor.container.parentNode).find(".preview>pre");
        let row = get_active_sheet().rows.filter(row=>row.isSelected)[0];
        if(row) {
            let data = {
                data: row.data,
                cols: row.vals,
                flds: row.fld_vals
            };
            console.log(data);
            with(data) {
                try {
                    previewEl.text(eval("`"+editor.getText()+"`"));
                }
                catch(e) {
                    previewEl.text("Invalid template. Fix it!")
                }
            }
        }
        else {
            previewEl.text("No rows selected")
        }
    }
    catch(e) {
        console.log(e);
    }
}
const pullReqTplEditor = new JSONEditor($("#pullReqTplEditor")[0], {mode: 'code',onChange: ()=>{preview_request(pullReqTplEditor)}});
const pushReqTplEditor = new JSONEditor($("#pushReqTplEditor")[0], {mode: 'code',onChange: ()=>{preview_request(pushReqTplEditor)}});
const importReqTplEditor = new JSONEditor($("#importReqTplEditor")[0], {mode: 'code',onChange: ()=>{preview_request(importReqTplEditor)}});

const pullReqTplPfx = "pullReqTpl_"
const pushReqTplPfx = "pushReqTpl_"
const importReqTplPfx = "importReqTpl_"

setup_req_tpl_select("#pullReqTemplates",pullReqTplPfx);
setup_req_tpl_select("#pushReqTemplates",pushReqTplPfx);
setup_req_tpl_select("#importReqTemplates",importReqTplPfx);

//let dt = dataTable("#preview");
function run_old() {
    
    $("#warning").remove();
    //setTimeout(()=>alert("Pull and import is safe always, push can lead to troubles.\nBe carefull! Don't get fired... or sued."),100);

    setTimeout(() => {
        zbx_connect();
        let data ;
        try {
            let lsdata = localStorage.getItem("tableData");
            data = JSON.parse(lsdata);
            dt.load_data(data);
        }
        catch(e) {
            console.log("No valid data saved in localstorage",lsdata);
        }
    }, 300);
    
}

function run() {
    $("#warning").remove();
    //setTimeout(()=>alert("Pull and import is safe always, push can lead to troubles.\nBe carefull! Don't get fired... or sued."),100);

    // load autosaved data
    setTimeout(() => {
        zbx_connect();
        let ws = load_saved_worksheets();
        console.log(ws);
        if(ws.length===0) {
            new_sheet();
        }
        ws = load_saved_worksheets();
        ws.forEach((s)=>{
            console.log(s)
            new_sheet(s.name);
            let dt = new DataTable("#"+s.name);
            workSheets[s.name] = dt;
            if(s.data) {
                dt.load_data(s.data.fields,s.data.records);
            }
        });
        let lastActive = localStorage.getItem("lastActiveSheet");
        lastActive = lastActive ? lastActive : "sheet1";
        $("#"+lastActive+"-tab").tab("show");
    }, 300);
}

$(document).ready(()=>{
    if(localStorage.getItem("userlevel")==="courageous") {
        run();
    }
});

let overlay = {
    el: $("#overlay"),
    show: function(){
        this.el.show();
    },
    hide: function(){
        this.el.hide();
    }
};

function generateUID() {
    // I generate the UID from two parts here 
    // to ensure the random number provide enough bits.
    var firstPart = (Math.random() * 46656) | 0;
    var secondPart = (Math.random() * 46656) | 0;
    firstPart = ("000" + firstPart.toString(36)).slice(-3);
    secondPart = ("000" + secondPart.toString(36)).slice(-3);
    return firstPart + secondPart;
}

function minimize_transform(event,force=false) {
    console.log(force)
    let slf = event.target;
    console.log(event,$(event.relatedTarget).parents(".transform")[0]==$(event.target).parents(".transform")[0] );
    if($(event.relatedTarget).parents(".transform")[0]==$(event.target).parents(".transform")[0] && !force) {
        return;
    }
    setTimeout(()=>$(slf).parents('.transform').removeClass('active'),100)
}

function save_transformation(src) {
    console.log("Save transformation",src.form.xpression.value);
    localStorage.setItem("transfo_"+generateUID(),src.form.xpression.value);
}

function remove_transformation(src) {
    localStorage.removeItem($(src.form.templates).val());
    $(src.form.templates).children(":selected").remove();
}

function list_transformations(src,ev) {
    if(ev.target.tagName==="OPTION")
        return;
    console.log(ev);
    let sel = $(src).empty();
    Object.keys(localStorage).filter(key=>key.indexOf("transfo_")!==-1).forEach(key=>{
        $("<option>").val(key).text(localStorage.getItem(key)).appendTo(sel)
    });
}

function load_transfo(src){
    src.form.xpression.value = $(src).children(":selected").text();
    $(src.form.xpression).trigger("focus").trigger("change");
    console.log(src);
}

/**
 *
 * @param val
 * @param {DataTable} dt
 * @param {int} searchCol
 */
function lookup(val,dt,searchCol,valueCol) {
    let col = dt.get_col_by_num(searchCol);
    for(let i=0;i<col.length;i++) {
        if(val==col[i].val){
            return dt.rows[i].cells[valueCol];
        }
    }
    return null;
}

/**

 plicuri
 - route (fk->route.id)

 routes

 /routes?filter=driver=gigi&include=plicuri
 */