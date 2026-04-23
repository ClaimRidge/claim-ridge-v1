import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from playwright.async_api import async_playwright
from core.security import get_current_user
import time

logger = logging.getLogger(__name__)

# --- Pydantic Models ---
class ClaimDataModel(BaseModel):
    patientName: str
    patientId: str
    patientDob: Optional[str] = None
    patientGender: Optional[str] = None
    providerName: str
    providerId: str
    providerSpecialty: Optional[str] = None
    payerCode: str
    payerNameEn: str
    payerNameAr: str
    policyNumber: str
    memberId: Optional[str] = None
    preauthNumber: Optional[str] = None
    dateOfService: str
    diagnosisCodes: List[str]
    procedureCodes: List[str]
    billedAmount: float
    clinicalNarrative: str
    additionalNotes: Optional[str] = None
    claimNumber: Optional[str] = None
    generatedAt: Optional[str] = None

# --- PDF Generation Logic ---
PAYER_COLORS = {
    "ARAB_ORIENT": "#1B4F72", "GIG_JORDAN": "#1A5276", "ALAI": "#145A32",
    "AL_NISR": "#6E2F0A", "ARAB_ASSURERS": "#2C3E50", "JORDAN_INSURANCE": "#1F618D",
    "MIDDLE_EAST_INS": "#7D6608", "ISLAMIC_INSURANCE": "#1E8449",
    "MEDNET": "#6C3483", "NEXTCARE": "#0E6655"
}

def generate_html_from_claim(claim: ClaimDataModel) -> str:
    accent_color = PAYER_COLORS.get(claim.payerCode, "#1a1a1a")
    
    dx_rows = "".join([f"<tr><td>{i+1}</td><td>{dx}</td><td>{'Primary' if i==0 else 'Secondary'}</td></tr>" 
                       for i, dx in enumerate(claim.diagnosisCodes) if dx])
    
    cpt_rows = "".join([f"<tr><td>{cpt}</td><td>{claim.dateOfService}</td>"
                        f"<td>{claim.billedAmount if i==0 else ''}</td>"
                        f"<td>{'Primary' if i==0 else 'Additional'}</td></tr>" 
                        for i, cpt in enumerate(claim.procedureCodes) if cpt])
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {{ font-family: Arial, sans-serif; font-size: 11px; padding: 30px; }}
        .header {{ border-bottom: 3px solid {accent_color}; padding-bottom: 12px; margin-bottom: 20px; }}
        .payer-name {{ font-size: 18px; font-weight: bold; color: {accent_color}; }}
        .section-title {{ font-size: 12px; font-weight: bold; background: #f0f0f0; padding: 4px 8px; border-left: 4px solid {accent_color}; margin-bottom: 8px; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
        th {{ background: {accent_color}; color: white; padding: 5px; text-align: left; }}
        td {{ border: 1px solid #ddd; padding: 5px; }}
      </style>
    </head>
    <body>
      <div class="header">
        <div class="payer-name">{claim.payerNameEn}</div>
        <div>Claim Number: {claim.claimNumber}</div>
      </div>
      <div class="section-title">Patient Info</div>
      <p>Name: {claim.patientName} | ID: {claim.patientId} | DOS: {claim.dateOfService}</p>
      
      <div class="section-title">Diagnosis Codes</div>
      <table><tr><th>#</th><th>Code</th><th>Type</th></tr>{dx_rows}</table>
      
      <div class="section-title">Procedure Codes</div>
      <table><tr><th>Code</th><th>Date</th><th>Amount</th><th>Type</th></tr>{cpt_rows}</table>
      
      <p><strong>Total Billed:</strong> {claim.billedAmount} JOD</p>
    </body>
    </html>
    """
    return html

# --- Router ---
router = APIRouter(prefix="/api/pdf", tags=["pdf"])

@router.post("/generate-claim-pdf")
async def generate_pdf(claim: ClaimDataModel, current_user = Depends(get_current_user)):
    try:
        logger.info(f"PDF generation request from user {current_user.id}, claim: {claim.claimNumber}")
        
        if not claim.claimNumber:
            claim.claimNumber = f"CR-{int(time.time())}"
            logger.debug(f"Generated claim number: {claim.claimNumber}")
        
        logger.debug(f"Generating HTML for claim {claim.claimNumber}")
        html_content = generate_html_from_claim(claim)
        
        logger.debug(f"Converting HTML to PDF using Playwright for claim {claim.claimNumber}")
        
        # --- PLAYWRIGHT LOGIC STARTS HERE ---
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            # Load the HTML content
            await page.set_content(html_content)
            
            # Generate the PDF
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,  # Ensures background colors (like the table headers) are printed
                margin={"top": "1cm", "right": "1cm", "bottom": "1cm", "left": "1cm"}
            )
            
            await browser.close()
        # --- PLAYWRIGHT LOGIC ENDS HERE ---

        filename = f"{claim.claimNumber}_{claim.payerCode}.pdf"
        logger.info(f"PDF generated successfully for claim {claim.claimNumber}, filename: {filename}")
        
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        logger.error(f"PDF generation failed for claim {claim.claimNumber}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))